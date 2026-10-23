import json
from collections.abc import Callable
from typing import Any

from starlette.concurrency import run_in_threadpool

from app import clock
from app.annuity import credit_summary
from app.assistant.targets import is_allowed_target
from app.db import Database
from app.fmt import age_label, date_ru, js_round, money, months_between, round_to
from app.insights import (
    avg_free_cash_flow,
    company_loans,
    debt_load,
    monthly_debt,
    operating_cash_flow,
    pre_approved_limit,
)
from app.labels import (
    COLLATERAL_LABELS,
    DOCUMENT_KIND_LABELS,
    PRODUCT_CATEGORY_LABELS,
    PURPOSE_LABELS,
    SIGNATURE_LABELS,
    TAX_SYSTEM_LABELS,
    next_step,
    status_description,
    status_title,
)
from app.models import ApplicationRecord, UserRecord
from app.queries import AUTOMATIC_DECISION, client_decision
from app.repo import Db
from app.schemas import AssistantAction, AssistantContext, AssistantHint, Product
from app.seeds import PRODUCTS

JsonDict = dict[str, Any]
Handler = Callable[[Db, UserRecord, int, JsonDict], JsonDict]

MAX_HINTS = 2
MAX_SUGGESTIONS = 3
REPAYMENT_LABELS = {
    "ANNUITY": "равные ежемесячные платежи",
    "REVOLVING": "возобновляемый лимит: проценты только на использованную сумму, долг гасится поступлениями на счёт",
}


def _function(name: str, description: str, properties: JsonDict, required: list[str] | None = None) -> JsonDict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required or []},
        },
    }


TOOL_SPECS: list[JsonDict] = [
    _function(
        "get_application",
        "Заявка клиента: статус, следующий шаг, решение и причины, предложение, запрос информации, договор. "
        "Без аргументов — заявка с экрана или последняя.",
        {"application_id": {"type": "string"}},
    ),
    _function("list_applications", "Все заявки клиента со статусами.", {}),
    _function(
        "get_company_overview",
        "Компания: реквизиты, возраст, обороты за 12 мес., чистый поток, предварительный лимит, кредиты.",
        {},
    ),
    _function(
        "list_products",
        "Продукты: группа, суммы, сроки, базовые ставки, обеспечение, целевое использование, "
        "нужен ли счёт поставщика, ограничение по отраслям.",
        {},
    ),
    _function(
        "calc_loan",
        "Платёж, переплата, доля платежа в чистом потоке и при его падении на 30%.",
        {
            "amount": {"type": "number", "description": "₽"},
            "term": {"type": "integer", "description": "месяцев"},
            "rate": {"type": "number", "description": "% годовых, по умолчанию базовая ставка продукта"},
            "product_code": {"type": "string", "enum": [product.code for product in PRODUCTS]},
        },
        ["amount", "term"],
    ),
    _function(
        "show_hints",
        "Подсказки под ответом: подсветка 0–2 элементов текущего экрана из списка в промпте "
        "и 2–3 коротких следующих вопроса от лица клиента.",
        {
            "highlight": {
                "type": "array",
                "maxItems": MAX_HINTS,
                "items": {
                    "type": "object",
                    "properties": {
                        "target": {"type": "string"},
                        "label": {"type": "string", "description": "подпись кнопки, «Показать …»"},
                    },
                    "required": ["target", "label"],
                },
            },
            "questions": {"type": "array", "maxItems": MAX_SUGGESTIONS, "items": {"type": "string"}},
        },
        ["questions"],
    ),
    _function(
        "fill_loan_form",
        "Подставить сумму и/или срок в форму на шаге «Сумма и срок». Только когда клиент прямо попросил "
        "или согласился на твоё предложение. Возвращает расчёт для новых значений.",
        {
            "amount": {"type": "number", "description": "сумма кредита, ₽"},
            "term": {"type": "integer", "description": "срок, месяцев"},
        },
    ),
]

UI_TOOLS = {"show_hints"}


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(" ", "").replace(",", "."))
        except ValueError:
            return None
    return None


class Toolbox:
    def __init__(self, database: Database, user_id: str, context: AssistantContext) -> None:
        self.database = database
        self.user_id = user_id
        self.context = context
        self.hints: list[AssistantHint] = []
        self.suggestions: list[str] = []
        self.actions: list[AssistantAction] = []

    async def run(self, name: str, raw_arguments: str | None) -> JsonDict:
        try:
            arguments = json.loads(raw_arguments or "{}")
        except json.JSONDecodeError:
            return {"error": "Аргументы должны быть JSON-объектом"}
        if not isinstance(arguments, dict):
            return {"error": "Аргументы должны быть JSON-объектом"}
        if name == "show_hints":
            return self.show_hints(arguments)
        handlers: dict[str, Handler] = {
            "get_application": self.get_application,
            "list_applications": self.list_applications,
            "get_company_overview": self.get_company_overview,
            "list_products": self.list_products,
            "calc_loan": self.calc_loan,
            "fill_loan_form": self.fill_loan_form,
        }
        handler = handlers.get(name)
        if not handler:
            return {"error": f"Неизвестный инструмент {name}"}
        return await run_in_threadpool(self.call, handler, arguments)

    def call(self, handler: Handler, arguments: JsonDict) -> JsonDict:
        with self.database.session() as session:
            db = Db(session)
            user = db.find_user(self.user_id)
            if not user:
                return {"error": "Пользователь не найден"}
            return handler(db, user, clock.now_ms(), arguments)

    def show_hints(self, arguments: JsonDict) -> JsonDict:
        rejected: list[str] = []
        items = arguments.get("highlight")
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            target = str(item.get("target", "")).strip()
            label = str(item.get("label", "")).strip()[:60] or "Показать на экране"
            if not is_allowed_target(self.context.screen, target) or len(self.hints) >= MAX_HINTS:
                rejected.append(target)
            elif all(hint.target != target for hint in self.hints):
                self.hints.append(AssistantHint(target=target, label=label))
        questions = arguments.get("questions")
        if isinstance(questions, list):
            cleaned = [str(item).strip()[:80] for item in questions if str(item).strip()]
            self.suggestions = list(dict.fromkeys(cleaned))[:MAX_SUGGESTIONS]
        result: JsonDict = {"ok": True, "highlighted": [hint.target for hint in self.hints]}
        if rejected:
            result["rejected"] = rejected
            result["note"] = "Таких элементов нет на текущем экране — не упоминай их"
        return result

    def _record(self, db: Db, user: UserRecord, application_id: str | None) -> ApplicationRecord | None:
        records = db.applications_of_company(user.company_id) if user.company_id else []
        wanted = application_id or self.context.application_id
        if wanted:
            return next((record for record in records if record.id == wanted), None)
        return max(records, key=lambda record: record.updated_at, default=None)

    def get_application(self, db: Db, user: UserRecord, _: int, arguments: JsonDict) -> JsonDict:
        requested = arguments.get("application_id")
        app = self._record(db, user, requested if isinstance(requested, str) and requested else None)
        if not app:
            return {"error": "Заявка не найдена"}
        result: JsonDict = {
            "id": app.id,
            "number": app.number,
            "status": app.status,
            "status_title": status_title(app.status),
            "what_is_happening": status_description(app.status),
            "next_step": next_step(app.status),
            "product": app.product.name,
            "purpose": PURPOSE_LABELS.get(app.purpose_type or "", app.purpose or "не указана"),
            "amount": app.amount,
            "term_months": app.term,
            "base_rate": app.product.base_rate,
            "created_at": date_ru(app.created_at),
            "submitted_at": date_ru(app.submitted_at) if app.submitted_at is not None else None,
            "documents": [DOCUMENT_KIND_LABELS[doc.kind] for doc in app.documents],
            "offer": None,
            "decision": None,
            "info_request": None,
            "contract": None,
            "disbursement": None,
            "assessment": None,
        }
        if app.offer:
            offer = app.offer
            result["offer"] = {
                "amount": offer.amount,
                "term_months": offer.term,
                "rate": offer.rate,
                "monthly_payment": offer.monthly_payment,
                "is_counter_offer": offer.is_counter,
                "status": offer.status,
                "valid_until": date_ru(offer.valid_until),
                "requested": offer.requested.model_dump(),
            }
        decision = client_decision(app.decision.model() if app.decision else None)
        if decision:
            result["decision"] = {
                "type": decision.type,
                "made_by": "автоматическое решение" if decision.made_by == AUTOMATIC_DECISION else "специалист банка",
                "reasons": decision.reasons,
                "date": date_ru(decision.created_at),
            }
        if app.info_request:
            result["info_request"] = {
                "status": app.info_request.status,
                "items": [
                    {"code": item.code, "label": item.label, "type": item.type} for item in app.info_request.items
                ],
                "comment": app.info_request.comment,
            }
        if app.contract:
            result["contract"] = {
                "number": app.contract.number,
                "signed_at": date_ru(app.contract.signed_at) if app.contract.signed_at is not None else None,
                "signed_with": SIGNATURE_LABELS[app.contract.signed_with] if app.contract.signed_with else None,
            }
        if app.disbursement:
            result["disbursement"] = {
                "operation_number": app.disbursement.operation_number,
                "amount": app.disbursement.amount,
                "date": date_ru(app.disbursement.created_at),
                "simulated": True,
            }
        scoring = app.scoring
        if scoring and app.decision:
            factors = scoring.factors
            result["assessment"] = {
                "strengths": [item.name for item in factors if item.points / item.max_points >= 0.7],
                "weaknesses": [
                    {"factor": item.name, "comment": item.comment}
                    for item in factors
                    if item.points / item.max_points <= 0.4
                ],
            }
        return result

    def list_applications(self, db: Db, user: UserRecord, _: int, __: JsonDict) -> JsonDict:
        records = db.applications_of_company(user.company_id) if user.company_id else []
        ordered = sorted(records, key=lambda record: record.updated_at, reverse=True)
        return {
            "applications": [
                {
                    "id": record.id,
                    "number": record.number,
                    "product": record.product.name,
                    "amount": record.amount,
                    "term_months": record.term,
                    "status": record.status,
                    "status_title": status_title(record.status),
                    "updated_at": date_ru(record.updated_at),
                }
                for record in ordered
            ]
        }

    def get_company_overview(self, db: Db, user: UserRecord, now: int, _: JsonDict) -> JsonDict:
        mc = db.find_company(user.company_id)
        if not mc:
            return {"error": "Компания ещё не добавлена"}
        company = mc.company
        loans = company_loans(db, mc, now)
        return {
            "name": company.name,
            "inn": company.inn,
            "legal_form": "ИП" if company.legal_form == "IP" else "ООО",
            "registration_date": date_ru(company.registration_date),
            "business_age": age_label(months_between(company.registration_date, now)),
            "tax_system": TAX_SYSTEM_LABELS[company.tax_system],
            "employees": company.employees_count,
            "has_bank_turnover": bool(mc.turnover),
            "avg_free_cash_flow": avg_free_cash_flow(mc.turnover),
            "cash_flow_before_loan_payments": operating_cash_flow(mc.turnover, loans),
            "current_monthly_loan_payments": monthly_debt(loans),
            "current_debt_load_percent": _load_percent(debt_load(mc.turnover, loans)),
            "pre_approved_limit": pre_approved_limit(db, mc, now),
            "turnover": [
                {
                    "month": month.month,
                    "inflow": month.inflow,
                    "outflow": month.outflow,
                    "free": month.inflow - month.outflow,
                }
                for month in mc.turnover[-12:]
            ],
            "loans": [
                {
                    "product": loan.product_name,
                    "contract": loan.contract_number,
                    "amount": loan.amount,
                    "balance": loan.balance,
                    "rate": loan.rate,
                    "monthly_payment": loan.monthly_payment,
                    "next_payment_date": date_ru(loan.next_payment_date),
                    "maturity_date": date_ru(loan.maturity_date),
                }
                for loan in loans
            ],
            "monthly_debt_payments": sum(loan.monthly_payment for loan in loans),
        }

    def list_products(self, db: Db, _: UserRecord, __: int, ___: JsonDict) -> JsonDict:
        return {
            "products": [
                {
                    "code": product.code,
                    "name": product.name,
                    "description": product.description,
                    "purposes": [PURPOSE_LABELS[item] for item in product.purpose_types],
                    "min_amount": product.min_amount,
                    "max_amount": product.max_amount,
                    "min_term_months": product.min_term,
                    "max_term_months": product.max_term,
                    "base_rate": product.base_rate,
                    "repayment": REPAYMENT_LABELS[product.repayment],
                    "down_payment_percent": js_round(product.down_payment_share * 100),
                    "requires_supplier_invoice": product.requires_invoice,
                    "group": PRODUCT_CATEGORY_LABELS[product.category],
                    "collateral": COLLATERAL_LABELS[product.collateral],
                    "targeted": product.targeted,
                    "priority_industries_only": bool(product.okved_prefixes),
                }
                for product in db.active_products()
            ]
        }

    def fill_loan_form(self, db: Db, user: UserRecord, now: int, arguments: JsonDict) -> JsonDict:
        if self.context.screen != "wizard.amount":
            return {
                "error": "Заполнить сумму и срок можно только на шаге «Сумма и срок» — предложи клиенту открыть его"
            }
        record = self._record(db, user, None) if self.context.application_id else None
        product = record.product if record else db.find_product(str(self.context.data.get("product_code") or ""))
        if not product:
            return {"error": "Не удалось определить продукт на экране"}
        amount = _number(arguments.get("amount"))
        term = _number(arguments.get("term"))
        if amount is None and term is None:
            return {"error": "Укажи сумму, срок или оба значения"}
        if amount is not None and not product.min_amount <= amount <= product.max_amount:
            return {
                "error": f"Сумма вне пределов продукта «{product.name}»: "
                f"от {money(product.min_amount)} до {money(product.max_amount)}"
            }
        if term is not None and not product.min_term <= term <= product.max_term:
            return {
                "error": f"Срок вне пределов продукта «{product.name}»: от {product.min_term} до {product.max_term} мес."
            }
        filled_amount = js_round(amount) if amount is not None else None
        filled_term = js_round(term) if term is not None else None
        self.actions = [AssistantAction(type="set_loan_params", amount=filled_amount, term=filled_term)]
        current_amount = _number(self.context.data.get("amount")) or (record.amount if record else product.min_amount)
        current_term = _number(self.context.data.get("term")) or (record.term if record else product.min_term)
        return {
            "ok": True,
            "filled": {"amount": filled_amount, "term_months": filled_term},
            "calculation": loan_facts(
                db,
                user,
                filled_amount if filled_amount is not None else current_amount,
                filled_term if filled_term is not None else js_round(current_term),
                product.base_rate,
                product,
                now,
            ),
        }

    def calc_loan(self, db: Db, user: UserRecord, now: int, arguments: JsonDict) -> JsonDict:
        amount = _number(arguments.get("amount"))
        term = _number(arguments.get("term"))
        if amount is None or amount <= 0 or term is None or not 1 <= term <= 120:
            return {"error": "Нужны сумма больше 0 и срок от 1 до 120 месяцев"}
        product = db.find_product(str(arguments.get("product_code") or self.context.data.get("product_code") or ""))
        rate = _number(arguments.get("rate"))
        if rate is None:
            rate = product.base_rate if product else _number(self.context.data.get("rate"))
        if rate is None or not 0 <= rate <= 100:
            return {"error": "Укажите ставку или код продукта"}
        return loan_facts(db, user, amount, js_round(term), rate, product, now)


def _load_percent(value: float | None) -> int | None:
    return js_round(value * 100) if value is not None else None


def loan_facts(
    db: Db, user: UserRecord, amount: float, term: int, rate: float, product: Product | None, now: int
) -> JsonDict:
    repayment = product.repayment if product else "ANNUITY"
    summary = credit_summary(repayment, amount, term, rate)
    result: JsonDict = {
        "amount": js_round(amount),
        "term_months": term,
        "rate": rate,
        "monthly_payment": summary.monthly_payment,
        "total_payment": summary.total_payment,
        "overpayment": summary.overpayment,
        "overpayment_share_percent": js_round(summary.overpayment / amount * 100),
    }
    if repayment == "REVOLVING":
        result["repayment"] = REPAYMENT_LABELS["REVOLVING"]
        result["note_on_payment"] = (
            "monthly_payment — проценты за месяц при полном использовании лимита; overpayment — проценты за весь срок "
            "при полном использовании, это верхняя оценка; основной долг гасится поступлениями на счёт"
        )
    if product and product.down_payment_share > 0:
        cost = js_round(amount / (1 - product.down_payment_share))
        result["equipment_cost"] = cost
        result["down_payment"] = cost - js_round(amount)
    if product:
        result["within_product_limits"] = (
            product.min_amount <= amount <= product.max_amount and product.min_term <= term <= product.max_term
        )
    mc = db.find_company(user.company_id)
    fcf = avg_free_cash_flow(mc.turnover) if mc else 0
    loans = company_loans(db, mc, now) if mc else []
    load = debt_load(mc.turnover, loans, summary.monthly_payment) if mc else None
    if mc and load is not None:
        free = [month.inflow - month.outflow for month in mc.turnover[-12:]]
        inflow = sum(month.inflow for month in mc.turnover[-12:]) / len(free)
        result["avg_free_cash_flow"] = fcf
        result["current_monthly_loan_payments"] = monthly_debt(loans)
        result["cash_flow_before_loan_payments"] = operating_cash_flow(mc.turnover, loans)
        result["debt_load_percent"] = _load_percent(load)
        result["revenue_drop_reserve_percent"] = max(0, js_round((fcf - summary.monthly_payment) / inflow * 100))
        result["months_not_covered"] = sum(1 for value in free if value < summary.monthly_payment)
        result["months_checked"] = len(free)
    else:
        result["avg_free_cash_flow"] = None
        result["note"] = "Оборотов по счёту нет или поток отрицательный — долю платежа в потоке оценить нельзя"
    return result


def screen_loan(db: Db, user: UserRecord, context: AssistantContext, now: int) -> JsonDict | None:
    amount = _number(context.data.get("amount"))
    term = _number(context.data.get("term"))
    if amount is None or amount <= 0 or term is None or not 1 <= term <= 120:
        return None
    product = db.find_product(str(context.data.get("product_code") or ""))
    rate = _number(context.data.get("rate"))
    if rate is None and product:
        rate = product.base_rate
    if rate is None or not 0 <= rate <= 100:
        return None
    months = js_round(term)
    facts = loan_facts(db, user, amount, months, rate, product, now)
    alternatives: list[JsonDict] = []
    if product and product.max_term > months:
        alternatives.append(loan_facts(db, user, amount, product.max_term, rate, product, now))
    if product:
        reduced = max(product.min_amount, round_to(amount * 0.8, 50_000))
        if reduced < amount:
            alternatives.append(loan_facts(db, user, reduced, months, rate, product, now))
    facts["alternatives"] = alternatives
    return facts

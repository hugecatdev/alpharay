import json
from functools import cache
from pathlib import Path
from string import Template

from app.annuity import loan_summary
from app.assistant.humanize import humanize_data
from app.assistant.targets import describe_targets
from app.assistant.tools import screen_loan
from app.config import settings
from app.fmt import age_label, date_ru, money, months_between, percent, rate_text
from app.insights import (
    COMFORT_LOAD,
    LIMIT_TERM,
    avg_free_cash_flow,
    company_loans,
    limit_rate,
    operating_cash_flow,
    pre_approved_limit,
)
from app.labels import TAX_SYSTEM_LABELS, next_step, status_title
from app.models import UserRecord
from app.queries import client_decision
from app.repo import Db
from app.schemas import AssistantContext

PROMPT_PATH = Path(__file__).with_name("system_prompt.md")


@cache
def prompt_template() -> Template:
    return Template(PROMPT_PATH.read_text("utf-8"))


def describe_company(db: Db, user: UserRecord, now: int) -> str:
    mc = db.find_company(user.company_id)
    if not mc:
        return "ещё не добавлена — клиент на онбординге, заявку подать нельзя, пока не привязан ИП или юрлицо."
    company = mc.company
    kind = "ИП" if company.legal_form == "IP" else "ООО"
    loans = company_loans(db, mc, now)
    debt = sum(loan.monthly_payment for loan in loans)
    lines = [
        f"{company.name} ({kind}), ИНН {company.inn}, {company.okved_name.lower()}, "
        f"в бизнесе {age_label(months_between(company.registration_date, now))}, "
        f"{TAX_SYSTEM_LABELS[company.tax_system]}, среднесписочная численность по ФНС за прошлый год {company.employees_count}."
    ]
    if mc.turnover:
        fcf = avg_free_cash_flow(mc.turnover)
        flow = operating_cash_flow(mc.turnover, loans)
        limit = pre_approved_limit(db, mc, now)
        rate = limit_rate(db)
        lines.append(
            f"По счёту за {len(mc.turnover)} мес.: чистый поток после текущих платежей в среднем {money(fcf)} в месяц, "
            f"денежный поток до платежей по кредитам — {money(flow)}."
        )
        lines.append(
            f"Предварительный лимит {money(limit)}: платёж на {LIMIT_TERM} мес. под {rate_text(rate)} — "
            f"{money(loan_summary(limit, LIMIT_TERM, rate).monthly_payment)}; вместе с текущими кредитами платежи "
            f"уложатся в {percent(COMFORT_LOAD * 100)} денежного потока."
            if limit
            else "Предварительного лимита нет: текущие платежи уже занимают комфортную долю потока, поток отрицательный или есть стоп-факторы."
        )
    else:
        lines.append("Не клиент банка: оборотов по счёту нет, нагрузку заранее не оценить.")
    lines.append(
        f"Действующих кредитов {len(loans)}, платежи по ним {money(debt)} в месяц."
        if loans
        else "Действующих кредитов нет."
    )
    return " ".join(lines)


def describe_application(db: Db, user: UserRecord, context: AssistantContext) -> str:
    app = db.find_application(context.application_id) if context.application_id else None
    if not app or not user.company_id or app.company_id != user.company_id:
        return ""
    parts = [
        f"Открыта заявка {app.number}: {app.product.name}, {money(app.amount)} на {app.term} мес., "
        f"статус «{status_title(app.status)}». Следующий шаг: {next_step(app.status)}"
    ]
    if app.offer:
        offer = app.offer
        parts.append(
            f"Условия банка: {money(offer.amount)} на {offer.term} мес. под {rate_text(offer.rate)}, "
            f"платёж {money(offer.monthly_payment)}, действует до {date_ru(offer.valid_until)}."
        )
    decision = client_decision(app.decision.model() if app.decision else None)
    if decision and decision.reasons:
        parts.append(f"Причины решения: {'; '.join(decision.reasons)}.")
    if app.info_request and app.info_request.status == "OPEN":
        parts.append(f"Банк просит: {'; '.join(item.label for item in app.info_request.items)}.")
    return " ".join(parts)


def describe_loan(db: Db, user: UserRecord, context: AssistantContext, now: int) -> str:
    facts = screen_loan(db, user, context, now)
    if not facts:
        return ""
    text = (
        f"Расчёт по экрану: {money(facts['amount'])} на {facts['term_months']} мес. под {rate_text(facts['rate'])} — "
        f"платёж {money(facts['monthly_payment'])}, всего {money(facts['total_payment'])}, "
        f"переплата {money(facts['overpayment'])} ({percent(facts['overpayment_share_percent'])} от суммы)."
    )
    if facts.get("note_on_payment"):
        text += " Это овердрафт: платёж — проценты при полном использовании лимита, долг гасится поступлениями."
    if facts.get("debt_load_percent") is not None:
        text += (
            f" Все платежи по кредитам вместе с новым — {percent(facts['debt_load_percent'])} денежного потока "
            f"до платежей по кредитам (комфортно до 40%); выручка может упасть на "
            f"{percent(facts['revenue_drop_reserve_percent'])}, прежде чем поток перестанет покрывать новый платёж; "
            f"поток не покрыл бы новый платёж в {facts['months_not_covered']} мес. из {facts['months_checked']}."
        )
    else:
        text += " Долю платежа в потоке оценить нельзя: оборотов по счёту нет."
    for option in facts["alternatives"]:
        text += (
            f" Вариант: {money(option['amount'])} на {option['term_months']} мес. — платёж {money(option['monthly_payment'])}, "
            f"переплата {money(option['overpayment'])}"
        )
        if option.get("debt_load_percent") is not None:
            text += f", нагрузка {percent(option['debt_load_percent'])}"
        text += "."
    return text


def build_system_prompt(db: Db, user: UserRecord, context: AssistantContext, now: int) -> str:
    return prompt_template().substitute(
        max_rounds=settings.llm_max_rounds,
        user=f"{user.full_name}, {user.position}",
        company=describe_company(db, user, now),
        screen=context.screen,
        screen_title=context.title or "без названия",
        application=describe_application(db, user, context),
        screen_data=json.dumps(humanize_data(context.data), ensure_ascii=False) if context.data else "нет",
        loan=describe_loan(db, user, context, now),
        targets=describe_targets(context.screen),
        today=date_ru(now),
    )

from dataclasses import dataclass, field

from app.annuity import credit_summary
from app.audit import record_audit
from app.fmt import DAY, clamp, date_ru, iso, money, rate_text
from app.insights import company_loans, derived_financials
from app.models import SYSTEM_ACTOR, Db, StoredApplication, StoredEvent, StoredNotification, StoredUser, uid
from app.products import okved_eligible
from app.schemas import (
    ActorType,
    ApplicationStatus,
    ContractRef,
    Decision,
    DecisionType,
    InfoRequest,
    InfoRequestItem,
    NotificationType,
    Offer,
    OfferRequested,
)
from app.scoring import (
    LOW_SCORE_REASON,
    RISK_MARKUP_REASON,
    client_approval_reasons,
    compute_recommendation,
    compute_scoring,
    counter_amount,
)

STAGE_MS = 2000
MOCK_FAIL_ENRICH_MS = 6000
DISBURSE_DELAY_MS = 3000
CONFIRMATION_CODE = "4821"
CLIENT_NOTIFIED_STAGE: ApplicationStatus = "VALIDATING"

NEXT_STAGE: dict[ApplicationStatus, ApplicationStatus] = {
    "SUBMITTED": "VALIDATING",
    "VALIDATING": "ENRICHING",
    "ENRICHING": "SCORING",
    "SCORING": "DECIDING",
}

STAGE_COPY: dict[ApplicationStatus, tuple[str, str, str]] = {
    "VALIDATING": (
        "Заявка принята в обработку",
        "Заявка на рассмотрении",
        "Проверяем данные компании и оцениваем заявку. Обычно это занимает меньше минуты — статус обновится сам.",
    ),
    "ENRICHING": (
        "Проверка полноты и корректности пройдена",
        "Проверка данных пройдена",
        "Запрашиваем сведения в ЕГРЮЛ, ФНС и бюро кредитных историй.",
    ),
    "SCORING": (
        "Получены данные ЕГРЮЛ, ФНС и БКИ",
        "Данные из внешних источников получены",
        "Оцениваем финансовое состояние бизнеса.",
    ),
    "DECIDING": (
        "Скоринговая оценка рассчитана",
        "Оценка завершена",
        "Формируем решение по заявке.",
    ),
}

CLIENT5_INFO_ITEMS = [
    InfoRequestItem(code="revenue_12m", label="Уточните выручку за 12 месяцев", type="number"),
    InfoRequestItem(code="statement_6m", label="Выписка по счёту за 6 месяцев", type="document"),
]


@dataclass
class DecisionInput:
    type: DecisionType
    reasons: list[str]
    amount: int | None = None
    term: int | None = None
    rate: float | None = None
    items: list[InfoRequestItem] = field(default_factory=list)
    comment: str = ""


def add_event(
    db: Db,
    record: StoredApplication,
    from_status: ApplicationStatus | None,
    to_status: ApplicationStatus,
    actor_type: ActorType,
    actor_name: str,
    reason: str | None,
    at: int,
) -> None:
    db.events.append(
        StoredEvent(
            id=uid(),
            application_id=record.app.id,
            from_status=from_status,
            to_status=to_status,
            actor_type=actor_type,
            actor_name=actor_name,
            reason=reason,
            created_at=iso(at),
        )
    )


def notify(db: Db, record: StoredApplication, kind: NotificationType, title: str, body: str, at: int) -> None:
    if not record.user_id:
        return
    db.notifications.append(
        StoredNotification(
            id=uid(),
            user_id=record.user_id,
            application_id=record.app.id,
            type=kind,
            title=title,
            body=body,
            is_read=False,
            created_at=iso(at),
        )
    )


def set_status(
    db: Db,
    record: StoredApplication,
    to_status: ApplicationStatus,
    at: int,
    actor_type: ActorType,
    actor_name: str,
    reason: str | None,
) -> None:
    from_status = record.app.status
    record.app.status = to_status
    record.app.updated_at = iso(at)
    record.stage_entered_at = at
    add_event(db, record, from_status, to_status, actor_type, actor_name, reason, at)


def contract_number(record: StoredApplication) -> str:
    return f"ДК-{record.app.number.replace('КР-', '')}"


def ensure_contract(record: StoredApplication) -> ContractRef:
    if not record.app.contract:
        record.app.contract = ContractRef(number=contract_number(record), signed_at=None)
    return record.app.contract


def create_offer(
    record: StoredApplication,
    amount: int,
    term: int,
    rate: float,
    is_counter: bool,
    at: int,
    valid_days: int,
) -> Offer:
    base = record.app.product.base_rate
    repayment = record.app.product.repayment
    return Offer(
        id=uid(),
        amount=amount,
        term=term,
        rate=rate,
        monthly_payment=credit_summary(repayment, amount, term, rate).monthly_payment,
        is_counter=is_counter,
        status="PENDING",
        valid_until=iso(at + valid_days * DAY),
        requested=OfferRequested(
            amount=record.app.amount,
            term=record.app.term,
            rate=base,
            monthly_payment=credit_summary(repayment, record.app.amount, record.app.term, base).monthly_payment,
        ),
    )


def apply_decision(
    db: Db,
    record: StoredApplication,
    decision: DecisionInput,
    actor_type: ActorType,
    actor_name: str,
    at: int,
) -> None:
    app = record.app
    app.decision = Decision(type=decision.type, made_by=actor_name, reasons=decision.reasons, created_at=iso(at))
    reason_text = decision.comment.strip() or (decision.reasons[0] if decision.reasons else None)

    if decision.type in ("APPROVED", "COUNTER_OFFER"):
        amount = decision.amount if decision.amount is not None else app.amount
        term = decision.term if decision.term is not None else app.term
        rate = decision.rate if decision.rate is not None else app.product.base_rate
        approved = decision.type == "APPROVED"
        is_counter = (amount != app.amount or term != app.term) if approved else True
        app.offer = create_offer(record, amount, term, rate, is_counter, at, db.policy.offer_valid_days)
        conditions = f"{money(amount)} на {term} мес. под {rate_text(rate)} годовых."
        if approved:
            app.contract = ContractRef(number=contract_number(record), signed_at=None)
            set_status(db, record, "APPROVED", at, actor_type, actor_name, reason_text or "Кредит одобрен")
            notify(
                db,
                record,
                "DECISION_MADE",
                "Кредит одобрен",
                f"{conditions} Проверьте условия и перейдите к подписанию договора.",
                at,
            )
        else:
            set_status(
                db, record, "COUNTER_OFFER", at, actor_type, actor_name, reason_text or "Предложены другие условия"
            )
            notify(
                db,
                record,
                "OFFER_PENDING",
                "Банк предлагает другие условия",
                f"{conditions} Предложение действует до {date_ru(app.offer.valid_until)}.",
                at,
            )
        return

    if decision.type == "NEED_INFO":
        app.info_request = InfoRequest(id=uid(), items=decision.items, comment=decision.comment, status="OPEN")
        set_status(
            db, record, "NEED_INFO", at, actor_type, actor_name, reason_text or "Запрошена дополнительная информация"
        )
        notify(
            db,
            record,
            "INFO_REQUESTED",
            "Нужна дополнительная информация",
            f"Банк просит: {'; '.join(item.label.lower() for item in decision.items)}.",
            at,
        )
        return

    if decision.type == "MANUAL_REVIEW":
        set_status(
            db,
            record,
            "MANUAL_REVIEW",
            at,
            actor_type,
            actor_name,
            reason_text or "Передана на рассмотрение специалисту",
        )
        if db.policy.auto_assign and not record.assignee_id:
            auto_assign(db, record, at)
        notify(
            db,
            record,
            "DECISION_MADE",
            "Заявка передана специалисту",
            "Кредитный специалист изучит заявку. Обычно это занимает до 1 рабочего дня.",
            at,
        )
        return

    set_status(db, record, "REJECTED", at, actor_type, actor_name, reason_text or "Отказ")
    notify(
        db,
        record,
        "DECISION_MADE",
        "Решение по заявке",
        "К сожалению, банк не может выдать кредит на запрошенных условиях. Причины — в карточке заявки.",
        at,
    )


def compute_assessment(db: Db, record: StoredApplication, at: int) -> None:
    mc = db.find_company(record.company_id)
    if not mc:
        return
    financials = record.app.financials or derived_financials(db, mc, at)
    scoring = compute_scoring(mc, record.app, financials, company_loans(db, mc, at), at, db.policy)
    record.scoring = scoring
    record.recommendation = compute_recommendation(scoring, record.app, db.policy)
    record.enriched = True


def _system_decision(db: Db, record: StoredApplication, decision: DecisionInput, at: int) -> None:
    apply_decision(db, record, decision, "SYSTEM", SYSTEM_ACTOR, at)


def apply_outcome(db: Db, record: StoredApplication, at: int) -> None:
    mc = db.find_company(record.company_id)
    app = record.app
    product = app.product
    base = product.base_rate
    key = mc.key if mc else "background"
    threshold = db.review_threshold(product.code)

    if key == "client1":
        if app.amount <= threshold:
            _system_decision(db, record, DecisionInput("APPROVED", client_approval_reasons(record.scoring), rate=base), at)
        else:
            _system_decision(
                db,
                record,
                DecisionInput("MANUAL_REVIEW", [f"Сумма выше порога автоматического решения {money(threshold)}"]),
                at,
            )
        return

    if key == "client2":
        if app.amount > 1_000_000:
            _system_decision(
                db,
                record,
                DecisionInput(
                    "COUNTER_OFFER",
                    [
                        "Бизнесу меньше года — лимит ограничен суммой 1 000 000 ₽",
                        "Короткая история оборотов по счёту",
                    ],
                    amount=max(product.min_amount, 1_000_000),
                    term=int(clamp(app.term, product.min_term, product.max_term)),
                    rate=base + 1,
                ),
                at,
            )
        else:
            _system_decision(
                db,
                record,
                DecisionInput("APPROVED", ["Короткая история бизнеса — ставка выше базовой на 2 п.п."], rate=base + 2),
                at,
            )
        return

    if key == "client3":
        _system_decision(
            db,
            record,
            DecisionInput(
                "MANUAL_REVIEW",
                ["В кредитной истории есть просрочка 45 дней", "Нужна экспертная оценка специалиста"],
            ),
            at,
        )
        return

    if key == "client4":
        _system_decision(
            db,
            record,
            DecisionInput("REJECTED", ["Просрочка по кредитам свыше 180 дней", "Налоговая задолженность 312 000 ₽"]),
            at,
        )
        return

    if key == "client5":
        if record.info_round == 0:
            _system_decision(
                db,
                record,
                DecisionInput(
                    "NEED_INFO",
                    ["Выручка в заявке расходится с данными ФНС"],
                    items=[item.model_copy() for item in CLIENT5_INFO_ITEMS],
                    comment="Выручка в заявке заметно выше, чем в налоговой декларации. Уточните цифру и приложите выписку.",
                ),
                at,
            )
        else:
            _system_decision(
                db,
                record,
                DecisionInput(
                    "APPROVED",
                    ["Расхождение с данными ФНС пояснено", "Выписка подтверждает обороты"],
                    rate=base + 0.5,
                ),
                at,
            )
        return

    policy_outcome(db, record, threshold, at)


def policy_outcome(db: Db, record: StoredApplication, threshold: int, at: int) -> None:
    app = record.app
    policy = db.policy
    scoring = record.scoring
    if scoring and scoring.stop_factors:
        if policy.stop_factors_decision == "REJECTED":
            _system_decision(db, record, DecisionInput("REJECTED", scoring.stop_factors), at)
        else:
            _system_decision(
                db, record, DecisionInput("MANUAL_REVIEW", ["Есть стоп-факторы — нужна оценка специалиста"]), at
            )
        return
    grade = scoring.grade if scoring else "C"
    rule = policy.grades[grade]
    rate = app.product.base_rate + rule.rate_markup
    if rule.auto_decision == "REJECTED":
        _system_decision(db, record, DecisionInput("REJECTED", [LOW_SCORE_REASON]), at)
    elif app.amount > threshold:
        _system_decision(
            db,
            record,
            DecisionInput("MANUAL_REVIEW", [f"Сумма выше порога автоматического решения {money(threshold)}"]),
            at,
        )
    elif rule.auto_decision == "MANUAL_REVIEW":
        _system_decision(db, record, DecisionInput("MANUAL_REVIEW", ["Нужна экспертная оценка специалиста"]), at)
    elif rule.auto_decision == "COUNTER_OFFER":
        _system_decision(
            db,
            record,
            DecisionInput(
                "COUNTER_OFFER",
                ["Условия скорректированы по кредитной политике банка"],
                amount=counter_amount(app, policy),
                term=app.term,
                rate=rate,
            ),
            at,
        )
    else:
        reasons = client_approval_reasons(scoring)
        if rule.rate_markup > 0:
            reasons.append(RISK_MARKUP_REASON)
        _system_decision(db, record, DecisionInput("APPROVED", reasons, rate=rate), at)


def active_reviews(db: Db, user_id: str) -> int:
    return sum(1 for item in db.applications if item.assignee_id == user_id and item.app.status == "MANUAL_REVIEW")


def assign(record: StoredApplication, user: StoredUser | None) -> None:
    record.assignee_id = user.id if user else None
    record.assigned_to = user.full_name if user else None


def auto_assign(db: Db, record: StoredApplication, at: int) -> None:
    candidates = [user for user in db.users if user.role == "UNDERWRITER" and user.active]
    if not candidates:
        return
    chosen = min(candidates, key=lambda user: (active_reviews(db, user.id), user.full_name))
    assign(record, chosen)
    record_audit(
        db,
        None,
        "application.assign",
        "application",
        record.app.id,
        f"Заявка {record.app.number} автоматически распределена: {chosen.full_name}",
        at,
    )


def disburse(db: Db, record: StoredApplication, at: int, actor_type: ActorType, actor_name: str) -> None:
    record.disbursed_at = iso(at)
    record.disburse_at = None
    set_status(db, record, "DISBURSED", at, actor_type, actor_name, "Средства перечислены на расчётный счёт")
    contract = record.app.contract.number if record.app.contract else ""
    notify(
        db,
        record,
        "DISBURSED",
        "Средства зачислены на расчётный счёт",
        f"{money(record.app.amount)} по договору {contract}. График платежей — в карточке заявки.",
        at,
    )


def advance_record(db: Db, record: StoredApplication, now: int) -> None:
    for _ in range(12):
        status = record.app.status
        entered = record.stage_entered_at
        upcoming = NEXT_STAGE.get(status)

        if upcoming or status == "DECIDING":
            failing = status == "ENRICHING" and record.mock_fail
            if failing and not record.mock_fail_event_done and now >= entered + STAGE_MS:
                add_event(
                    db,
                    record,
                    "ENRICHING",
                    "ENRICHING",
                    "SYSTEM",
                    SYSTEM_ACTOR,
                    "Бюро кредитных историй не ответило — повторный запрос в БКИ",
                    entered + STAGE_MS,
                )
                record.mock_fail_event_done = True
            duration = MOCK_FAIL_ENRICH_MS if failing else STAGE_MS
            if now - entered < duration:
                return
            at = entered + duration
            if status == "DECIDING":
                apply_outcome(db, record, at)
                continue
            if upcoming == "SCORING" or (upcoming == "DECIDING" and not record.enriched):
                compute_assessment(db, record, at)
            reason, title, body = STAGE_COPY[upcoming]
            set_status(db, record, upcoming, at, "SYSTEM", SYSTEM_ACTOR, reason)
            if upcoming == CLIENT_NOTIFIED_STAGE:
                notify(db, record, "STAGE_PASSED", title, body, at)
            continue

        if status == "SIGNED" and record.disburse_at is not None and now >= record.disburse_at:
            disburse(db, record, record.disburse_at, "SYSTEM", SYSTEM_ACTOR)
            continue
        return


def advance_all(db: Db, now: int) -> None:
    for record in db.applications:
        advance_record(db, record, now)


def submit_missing(db: Db, record: StoredApplication) -> list[str]:
    app = record.app
    product = app.product
    missing: list[str] = []
    catalog = db.find_product(product.code)
    if not catalog or not catalog.active:
        missing.append("product")
    elif not okved_eligible(catalog, app.company.okved_main):
        missing.append("product_eligibility")
    if not (product.min_amount <= app.amount <= product.max_amount):
        missing.append("amount")
    if not (product.min_term <= app.term <= product.max_term):
        missing.append("term")
    if not app.company_confirmed:
        missing.append("company_confirmed")
    if not app.financials:
        missing.append("financials")
    if product.requires_invoice and not any(doc.kind == "EQUIPMENT_INVOICE" for doc in app.documents):
        missing.append("equipment_invoice")
    if not app.consents.bki:
        missing.append("consent_bki")
    if not app.consents.personal_data:
        missing.append("consent_personal_data")
    if not app.consents.risks:
        missing.append("consent_risks")
    return missing


def submit_application(db: Db, record: StoredApplication, actor_name: str, now: int, mock_fail: bool) -> None:
    record.mock_fail = mock_fail
    record.mock_fail_event_done = False
    record.enriched = False
    record.app.submitted_at = iso(now)
    set_status(db, record, "SUBMITTED", now, "CLIENT", actor_name, "Заявка отправлена клиентом")
    notify(
        db,
        record,
        "APPLICATION_SUBMITTED",
        "Заявка отправлена",
        f"Заявка {record.app.number} принята банком. Статус обновляется автоматически.",
        now,
    )


def schedule_disbursement(db: Db, record: StoredApplication, now: int) -> None:
    record.disburse_at = now + DISBURSE_DELAY_MS if db.policy.auto_disbursement else None

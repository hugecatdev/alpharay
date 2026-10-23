import hashlib
import logging
from dataclasses import dataclass

from app.annuity import credit_summary
from app.audit import record_audit
from app.decision import Case, Verdict, decide, recommend, unavailable
from app.fmt import DAY, date_ru, local, money, rate_text
from app.insights import derived_financials
from app.integrations import (
    SOURCE_NAMES,
    CheckOutcome,
    IntegrationError,
    account_check,
    bki_check,
    bki_failure,
    egrul_check,
    fns_check,
    gateway,
)
from app.logs import current_correlation
from app.models import (
    SYSTEM_ACTOR,
    ApplicationRecord,
    AssessmentRecord,
    CheckRecord,
    CompanyRecord,
    ContractRecord,
    DecisionRecord,
    DisbursementRecord,
    EventRecord,
    InfoRequestRecord,
    NotificationRecord,
    OfferRecord,
    RevisionRecord,
    UserRecord,
    uid,
)
from app.products import okved_eligible
from app.repo import Db
from app.schemas import (
    ActiveLoan,
    ActorType,
    ApplicationStatus,
    BkiData,
    Certificate,
    Company,
    Consents,
    EgrulData,
    FnsData,
    InfoAnswer,
    NotificationType,
    OfferRequested,
    Product,
    RevisionReason,
    SignatureType,
    TurnoverMonth,
)
from app.scoring import MODEL_VERSION, Sources, compute_scoring

logger = logging.getLogger("alpharay.pipeline")

STAGE_MS = 2000
BKI_RETRY_MS = 2000
BKI_ATTEMPTS = 3
DISBURSE_DELAY_MS = 3000
CONFIRMATION_CODE = "4821"
MAX_STEPS = 24

PROCESSING: tuple[ApplicationStatus, ...] = ("SUBMITTED", "VALIDATING", "ENRICHING", "SCORING", "DECIDING")
OFFER_STATUSES: tuple[ApplicationStatus, ...] = ("APPROVED", "COUNTER_OFFER")

TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"SUBMITTED", "CANCELLED"}),
    "SUBMITTED": frozenset({"VALIDATING", "CANCELLED"}),
    "VALIDATING": frozenset({"ENRICHING", "CANCELLED"}),
    "ENRICHING": frozenset({"SCORING", "MANUAL_REVIEW", "CANCELLED"}),
    "SCORING": frozenset({"DECIDING", "CANCELLED"}),
    "DECIDING": frozenset({"APPROVED", "COUNTER_OFFER", "NEED_INFO", "MANUAL_REVIEW", "REJECTED", "CANCELLED"}),
    "MANUAL_REVIEW": frozenset({"APPROVED", "COUNTER_OFFER", "NEED_INFO", "REJECTED", "CANCELLED"}),
    "NEED_INFO": frozenset({"SUBMITTED", "CANCELLED"}),
    "APPROVED": frozenset({"OFFER_ACCEPTED", "CLIENT_DECLINED", "EXPIRED", "CANCELLED"}),
    "COUNTER_OFFER": frozenset({"OFFER_ACCEPTED", "CLIENT_DECLINED", "EXPIRED", "CANCELLED"}),
    "OFFER_ACCEPTED": frozenset({"SIGNING", "CANCELLED"}),
    "SIGNING": frozenset({"SIGNED", "CANCELLED"}),
    "SIGNED": frozenset({"DISBURSED"}),
    "DISBURSED": frozenset(),
    "REJECTED": frozenset(),
    "CLIENT_DECLINED": frozenset(),
    "CANCELLED": frozenset(),
    "EXPIRED": frozenset(),
}
CANCELLABLE: tuple[ApplicationStatus, ...] = tuple(
    status for status, targets in TRANSITIONS.items() if "CANCELLED" in targets
)

STAGE_REASONS: dict[ApplicationStatus, str] = {
    "VALIDATING": "Заявка принята в обработку",
    "ENRICHING": "Проверка полноты и корректности пройдена",
    "SCORING": "Получены данные ЕГРЮЛ, ФНС и БКИ",
    "DECIDING": "Скоринговая оценка рассчитана",
}
REVIEW_STARTED = (
    "Заявка на рассмотрении",
    "Проверяем данные компании и оцениваем заявку. Обычно это занимает меньше минуты — статус обновится сам.",
)


class TransitionError(Exception):
    def __init__(self, source: str, target: str) -> None:
        super().__init__(f"{source} → {target}")
        self.source = source
        self.target = target


@dataclass(frozen=True)
class Actor:
    type: ActorType
    name: str
    id: str | None = None


SYSTEM = Actor("SYSTEM", SYSTEM_ACTOR)


def actor_of(user: UserRecord) -> Actor:
    return Actor("UNDERWRITER" if user.is_bank else "CLIENT", user.full_name, user.id)


def add_event(
    db: Db,
    record: ApplicationRecord,
    from_status: str | None,
    to_status: str,
    actor: Actor,
    reason: str | None,
    at: int,
) -> None:
    db.add(
        EventRecord(
            id=uid(),
            application_id=record.id,
            from_status=from_status,
            to_status=to_status,
            actor_type=actor.type,
            actor_id=actor.id,
            actor_name=actor.name,
            reason=reason,
            correlation_id=current_correlation(),
            created_at=at,
        )
    )


def notify(db: Db, record: ApplicationRecord, kind: NotificationType, title: str, body: str, at: int) -> None:
    if not record.user_id:
        return
    db.add(
        NotificationRecord(
            id=uid(),
            user_id=record.user_id,
            application_id=record.id,
            type=kind,
            title=title,
            body=body,
            is_read=False,
            created_at=at,
        )
    )


def due_time(db: Db, record: ApplicationRecord, at: int) -> int | None:
    if record.status in PROCESSING:
        return at + STAGE_MS
    offer = record.offer
    if record.status in OFFER_STATUSES and offer and offer.status == "PENDING":
        return offer.valid_until
    if record.status == "SIGNED" and db.policy.auto_disbursement:
        return at + DISBURSE_DELAY_MS
    return None


def touch(record: ApplicationRecord, at: int) -> None:
    record.updated_at = at
    record.version += 1


def set_status(
    db: Db,
    record: ApplicationRecord,
    to_status: ApplicationStatus,
    at: int,
    actor: Actor,
    reason: str | None,
) -> None:
    from_status = record.status
    if to_status not in TRANSITIONS.get(from_status, frozenset()):
        raise TransitionError(from_status, to_status)
    record.status = to_status
    record.stage_entered_at = at
    record.failures = 0
    touch(record, at)
    record.next_run_at = due_time(db, record, at)
    add_event(db, record, from_status, to_status, actor, reason, at)


def contract_number(record: ApplicationRecord) -> str:
    return f"ДК-{record.number.replace('КР-', '')}"


def settlement_account(company: Company) -> str:
    prefix = "40802810" if company.legal_form == "IP" else "40702810"
    digits = str(int(hashlib.sha256(company.inn.encode()).hexdigest(), 16))
    return prefix + digits[:12]


def snapshot(
    db: Db,
    record: ApplicationRecord,
    reason: RevisionReason,
    actor: Actor,
    at: int,
    answers: list[InfoAnswer] | None = None,
) -> RevisionRecord:
    record.revision += 1
    revision = RevisionRecord(
        id=uid(),
        application_id=record.id,
        sequence=record.revision,
        reason=reason,
        product=record.product,
        company=record.company,
        amount=record.amount,
        term=record.term,
        purpose=record.purpose,
        purpose_type=record.purpose_type,
        financials=record.financials,
        consents=record.consents,
        documents=[document.model() for document in record.documents],
        answers=list(answers or []),
        author_id=actor.id,
        author_name=actor.name,
        created_at=at,
    )
    record.revisions.append(revision)
    return revision


def record_check(
    record: ApplicationRecord, revision: RevisionRecord, outcome: CheckOutcome, attempt: int, at: int
) -> CheckRecord:
    check = CheckRecord(
        id=uid(),
        application_id=record.id,
        revision_id=revision.id,
        check_type=outcome.type,
        source=SOURCE_NAMES[outcome.type],
        status=outcome.status,
        attempt=attempt,
        result=outcome.data,
        summary=outcome.summary,
        error=outcome.error,
        checked_at=at,
    )
    record.checks.append(check)
    return check


def revision_checks(record: ApplicationRecord, revision: RevisionRecord) -> dict[str, CheckRecord]:
    latest: dict[str, CheckRecord] = {}
    for check in record.checks:
        if check.revision_id == revision.id and check.status != "ERROR":
            latest[check.check_type] = check
    return latest


def bki_attempts(record: ApplicationRecord, revision: RevisionRecord) -> int:
    return sum(
        1
        for check in record.checks
        if check.revision_id == revision.id and check.check_type == "BKI" and check.status == "ERROR"
    )


def require_revision(record: ApplicationRecord) -> RevisionRecord:
    revision = record.current_revision
    if revision is None:
        raise LookupError(f"У заявки {record.number} нет снимка данных")
    return revision


def submit_missing(db: Db, record: ApplicationRecord) -> list[str]:
    product = record.product
    missing: list[str] = []
    catalog = db.find_product(product.code)
    if not catalog or not catalog.active:
        missing.append("product")
    elif not okved_eligible(catalog, record.company.okved_main):
        missing.append("product_eligibility")
    if not (product.min_amount <= record.amount <= product.max_amount):
        missing.append("amount")
    if not (product.min_term <= record.term <= product.max_term):
        missing.append("term")
    if not record.company_confirmed:
        missing.append("company_confirmed")
    if not record.financials:
        missing.append("financials")
    if product.requires_invoice and not any(doc.kind == "EQUIPMENT_INVOICE" for doc in record.documents):
        missing.append("equipment_invoice")
    if not record.consents.bki:
        missing.append("consent_bki")
    if not record.consents.personal_data:
        missing.append("consent_personal_data")
    if not record.consents.risks:
        missing.append("consent_risks")
    return missing


def create_draft(
    db: Db,
    mc: CompanyRecord,
    product: Product,
    amount: int,
    term: int,
    purpose: str,
    purpose_type: str | None,
    author: UserRecord | None,
    at: int,
    previous: ApplicationRecord | None = None,
) -> ApplicationRecord:
    record = ApplicationRecord(
        id=uid(),
        number=db.next_number(),
        status="DRAFT",
        company_id=mc.id,
        user_id=author.id if author else None,
        product_code=product.code,
        product=product.model_copy(deep=True),
        company=mc.company,
        amount=amount,
        term=term,
        purpose=purpose,
        purpose_type=purpose_type,
        company_confirmed=False,
        financials=previous.financials if previous else None,
        consents=Consents(),
        previous_application_id=previous.id if previous else None,
        revision=0,
        version=1,
        mock_fail=0,
        failures=0,
        stage_entered_at=at,
        next_run_at=None,
        created_at=at,
        submitted_at=None,
        updated_at=at,
    )
    db.add(record)
    actor = actor_of(author) if author else Actor("CLIENT", mc.head_name)
    reason = f"Повторная подача по заявке {previous.number}" if previous else "Создан черновик заявки"
    add_event(db, record, None, "DRAFT", actor, reason, at)
    return record


def submit_application(db: Db, record: ApplicationRecord, actor: Actor, now: int, mock_fail: int) -> None:
    record.mock_fail = mock_fail
    record.submitted_at = now
    snapshot(db, record, "SUBMITTED", actor, now)
    set_status(db, record, "SUBMITTED", now, actor, "Заявка отправлена клиентом")
    notify(
        db,
        record,
        "APPLICATION_SUBMITTED",
        "Заявка отправлена",
        f"Заявка {record.number} принята банком. Статус обновляется автоматически.",
        now,
    )


def provide_info(
    db: Db,
    record: ApplicationRecord,
    request: InfoRequestRecord,
    answers: list[InfoAnswer],
    actor: Actor,
    at: int,
) -> None:
    request.status = "ANSWERED"
    request.answers = answers
    request.answered_at = at
    request.answered_by = actor.id
    revision = snapshot(db, record, "INFO_PROVIDED", actor, at, answers)
    request.reply_revision_id = revision.id
    record.mock_fail = 0
    set_status(db, record, "SUBMITTED", at, actor, "Клиент дополнил заявку")
    notify(db, record, "APPLICATION_SUBMITTED", "Заявка дополнена", "Спасибо! Банк продолжил рассмотрение заявки.", at)


def cancel_application(db: Db, record: ApplicationRecord, actor: Actor, at: int) -> None:
    offer = record.offer
    if offer and offer.status == "PENDING":
        offer.status = "DECLINED"
        offer.responded_at = at
        offer.responded_by = actor.id
    for request in record.info_requests:
        if request.status == "OPEN":
            request.status = "CANCELLED"
    set_status(db, record, "CANCELLED", at, actor, "Заявка отменена клиентом")


def create_offer(
    db: Db,
    record: ApplicationRecord,
    decision: DecisionRecord,
    amount: int,
    term: int,
    rate: float,
    is_counter: bool,
    at: int,
) -> OfferRecord:
    product = record.product
    base = product.base_rate
    offer = OfferRecord(
        id=uid(),
        application_id=record.id,
        version=len(record.offers) + 1,
        decision_id=decision.id,
        amount=amount,
        term=term,
        rate=rate,
        monthly_payment=credit_summary(product.repayment, amount, term, rate).monthly_payment,
        is_counter=is_counter,
        status="PENDING",
        requested=OfferRequested(
            amount=record.amount,
            term=record.term,
            rate=base,
            monthly_payment=credit_summary(product.repayment, record.amount, record.term, base).monthly_payment,
        ),
        valid_until=at + db.policy.offer_valid_days * DAY,
        created_at=at,
    )
    record.offers.append(offer)
    return offer


def assign(record: ApplicationRecord, user: UserRecord | None) -> None:
    record.assignee = user
    record.assignee_id = user.id if user else None


def auto_assign(db: Db, record: ApplicationRecord, at: int) -> None:
    candidates = [user for user in db.users() if user.role == "UNDERWRITER" and user.active]
    if not candidates:
        return
    chosen = min(candidates, key=lambda user: (db.active_reviews(user.id), user.full_name))
    assign(record, chosen)
    record_audit(
        db,
        None,
        "application.assign",
        "application",
        record.id,
        f"Заявка {record.number} автоматически распределена: {chosen.full_name}",
        at,
    )


def apply_verdict(db: Db, record: ApplicationRecord, verdict: Verdict, actor: Actor, at: int) -> DecisionRecord:
    revision = record.current_revision
    assessment = record.assessment
    decision = DecisionRecord(
        id=uid(),
        application_id=record.id,
        revision_id=revision.id if revision else None,
        assessment_id=assessment.id if assessment and revision and assessment.revision_id == revision.id else None,
        outcome=verdict.type,
        reasons=list(verdict.reasons),
        reason_codes=list(verdict.codes),
        comment=verdict.comment,
        actor_type=actor.type,
        actor_id=actor.id,
        actor_name=actor.name,
        policy_version=db.policy_record.version,
        created_at=at,
    )
    record.decisions.append(decision)
    reason_text = verdict.comment.strip() or (verdict.reasons[0] if verdict.reasons else None)

    if verdict.type in ("APPROVED", "COUNTER_OFFER"):
        amount = verdict.amount if verdict.amount is not None else record.amount
        term = verdict.term if verdict.term is not None else record.term
        rate = verdict.rate if verdict.rate is not None else record.product.base_rate
        approved = verdict.type == "APPROVED"
        is_counter = (amount != record.amount or term != record.term) if approved else True
        offer = create_offer(db, record, decision, amount, term, rate, is_counter, at)
        conditions = f"{money(amount)} на {term} мес. под {rate_text(rate)} годовых."
        if approved:
            set_status(db, record, "APPROVED", at, actor, reason_text or "Кредит одобрен")
            notify(
                db,
                record,
                "DECISION_MADE",
                "Кредит одобрен",
                f"{conditions} Примите условия до {date_ru(offer.valid_until)} и подпишите договор.",
                at,
            )
        else:
            set_status(db, record, "COUNTER_OFFER", at, actor, reason_text or "Предложены другие условия")
            notify(
                db,
                record,
                "OFFER_PENDING",
                "Банк предлагает другие условия",
                f"{conditions} Предложение действует до {date_ru(offer.valid_until)}.",
                at,
            )
        return decision

    if verdict.type == "NEED_INFO":
        record.info_requests.append(
            InfoRequestRecord(
                id=uid(),
                application_id=record.id,
                decision_id=decision.id,
                items=[item.model_copy() for item in verdict.items],
                comment=verdict.comment,
                status="OPEN",
                answers=[],
                created_at=at,
            )
        )
        set_status(db, record, "NEED_INFO", at, actor, reason_text or "Запрошена дополнительная информация")
        notify(
            db,
            record,
            "INFO_REQUESTED",
            "Нужна дополнительная информация",
            f"Банк просит: {'; '.join(item.label.lower() for item in verdict.items)}.",
            at,
        )
        return decision

    if verdict.type == "MANUAL_REVIEW":
        set_status(db, record, "MANUAL_REVIEW", at, actor, reason_text or "Передана на рассмотрение специалисту")
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
        return decision

    set_status(db, record, "REJECTED", at, actor, reason_text or "Отказ")
    notify(
        db,
        record,
        "DECISION_MADE",
        "Решение по заявке",
        "К сожалению, банк не может выдать кредит на запрошенных условиях. Причины — в карточке заявки.",
        at,
    )
    return decision


def build_case(db: Db, record: ApplicationRecord, at: int) -> Case:
    revision = require_revision(record)
    checks = revision_checks(record, revision)
    mc = db.find_company(record.company_id)
    if mc is None:
        raise LookupError(f"Компания заявки {record.number} не найдена")
    account = checks["ACCOUNT"].result or {}
    sources = Sources(
        company=revision.company,
        egrul=EgrulData.model_validate(checks["EGRUL"].result),
        fns=FnsData.model_validate(checks["FNS"].result),
        bki=BkiData.model_validate(checks["BKI"].result),
        turnover=[TurnoverMonth.model_validate(item) for item in account.get("turnover", [])],
    )
    loans = [ActiveLoan.model_validate(item) for item in account.get("loans", [])]
    financials = revision.financials or derived_financials(db, mc, at)
    policy = db.policy
    assessment = record.assessment
    scoring = (
        assessment.scoring()
        if assessment and assessment.revision_id == revision.id
        else compute_scoring(sources, revision.product, revision.amount, revision.term, financials, loans, at, policy)
    )
    answered = [request for request in record.info_requests if request.status == "ANSWERED"]
    return Case(
        sources=sources,
        product=revision.product,
        amount=revision.amount,
        term=revision.term,
        financials=financials,
        loans=loans,
        scoring=scoring,
        policy=policy,
        threshold=db.review_threshold(revision.product.code),
        now=at,
        revenue_clarified=any(item.code == "revenue_12m" for request in answered for item in request.items),
        statement_provided=any(item.type == "document" for request in answered for item in request.items)
        or any(document.kind == "BANK_STATEMENT" for document in record.documents),
    )


def validate(db: Db, record: ApplicationRecord, at: int) -> None:
    revision = require_revision(record)
    outcome = CheckOutcome(
        "COMPLETENESS",
        "OK",
        f"Анкета заполнена: {money(revision.amount)} на {revision.term} мес., финансы и согласия на месте",
    )
    record_check(record, revision, outcome, 1, at)
    set_status(db, record, "ENRICHING", at, SYSTEM, STAGE_REASONS["ENRICHING"])


def enrich(db: Db, record: ApplicationRecord, at: int) -> None:
    revision = require_revision(record)
    mc = db.find_company(record.company_id)
    if mc is None:
        raise LookupError(f"Компания заявки {record.number} не найдена")
    failures = bki_attempts(record, revision)
    attempt = failures + 1
    if failures == 0:
        record_check(record, revision, egrul_check(gateway.egrul(mc), revision.company.head_name), 1, at)
        record_check(record, revision, fns_check(gateway.fns(mc)), 1, at)
        turnover, loans = gateway.account(db, mc, at)
        record_check(record, revision, account_check(turnover, loans), 1, at)
    try:
        report = gateway.bki(db, mc, at, attempt, record.mock_fail)
    except IntegrationError as error:
        record_check(record, revision, bki_failure(attempt, BKI_ATTEMPTS, str(error)), attempt, at)
        logger.warning(
            "БКИ не ответило по заявке %s",
            record.number,
            extra={"application_id": record.id, "attempt": attempt, "step": "ENRICHING"},
        )
        if attempt < BKI_ATTEMPTS:
            add_event(
                db,
                record,
                "ENRICHING",
                "ENRICHING",
                SYSTEM,
                f"Бюро кредитных историй не ответило — повторный запрос в БКИ (попытка {attempt + 1} из {BKI_ATTEMPTS})",
                at,
            )
            record.next_run_at = at + BKI_RETRY_MS
            return
        apply_verdict(db, record, unavailable(), SYSTEM, at)
        return
    record_check(record, revision, bki_check(report), attempt, at)
    set_status(db, record, "SCORING", at, SYSTEM, STAGE_REASONS["SCORING"])


def assess(db: Db, record: ApplicationRecord, at: int) -> None:
    revision = require_revision(record)
    case = build_case(db, record, at)
    scoring = case.scoring
    record.assessments.append(
        AssessmentRecord(
            id=uid(),
            application_id=record.id,
            revision_id=revision.id,
            model_version=MODEL_VERSION,
            policy_version=db.policy_record.version,
            score=scoring.score,
            grade=scoring.grade,
            factors=scoring.factors,
            stop_factors=scoring.stop_factors,
            recommendation=recommend(case),
            created_at=at,
        )
    )
    set_status(db, record, "DECIDING", at, SYSTEM, STAGE_REASONS["DECIDING"])


def decide_automatically(db: Db, record: ApplicationRecord, at: int) -> DecisionRecord:
    return apply_verdict(db, record, decide(build_case(db, record, at)), SYSTEM, at)


def expire_offer(db: Db, record: ApplicationRecord, at: int) -> None:
    offer = record.offer
    if offer and offer.status == "PENDING":
        offer.status = "EXPIRED"
        offer.responded_at = at
    set_status(db, record, "EXPIRED", at, SYSTEM, "Срок действия предложения истёк")
    notify(
        db,
        record,
        "OFFER_EXPIRED",
        "Срок предложения истёк",
        f"Предложение по заявке {record.number} не было принято вовремя. Подайте заявку повторно — условия рассчитаем заново.",
        at,
    )


def accept_offer(db: Db, record: ApplicationRecord, offer: OfferRecord, actor: Actor, at: int) -> None:
    offer.status = "ACCEPTED"
    offer.responded_at = at
    offer.responded_by = actor.id
    record.amount = offer.amount
    record.term = offer.term
    if record.contract is None:
        record.contract = ContractRecord(
            application_id=record.id, number=contract_number(record), offer_id=offer.id, created_at=at
        )
    else:
        record.contract.offer_id = offer.id
    set_status(db, record, "OFFER_ACCEPTED", at, actor, "Клиент принял предложение банка")


def decline_offer(db: Db, record: ApplicationRecord, offer: OfferRecord, actor: Actor, at: int) -> None:
    offer.status = "DECLINED"
    offer.responded_at = at
    offer.responded_by = actor.id
    set_status(db, record, "CLIENT_DECLINED", at, actor, "Клиент отклонил предложение банка")


def start_signing(db: Db, record: ApplicationRecord, actor: Actor, at: int) -> None:
    set_status(db, record, "SIGNING", at, actor, "Договор направлен на подписание")
    notify(
        db,
        record,
        "CONTRACT_READY",
        "Договор готов к подписанию",
        "Подпишите договор в кабинете: подписание смоделировано, реальная электронная подпись не используется.",
        at,
    )


def complete_signing(
    db: Db,
    record: ApplicationRecord,
    actor: Actor,
    at: int,
    method: SignatureType,
    certificate: Certificate | None,
    reason: str,
) -> None:
    contract = record.contract
    if contract is None:
        raise LookupError(f"Договор заявки {record.number} не сформирован")
    contract.signed_at = at
    contract.signed_with = method
    contract.signed_by = actor.id
    contract.certificate = certificate
    set_status(db, record, "SIGNED", at, actor, reason)


def disburse(db: Db, record: ApplicationRecord, at: int, actor: Actor) -> DisbursementRecord:
    if record.disbursement is not None:
        return record.disbursement
    offer = record.offer
    contract = record.contract
    operation = f"PAY-{local(at):%Y%m%d}-{db.next_operation():06d}"
    disbursement = DisbursementRecord(
        id=uid(),
        application_id=record.id,
        offer_id=offer.id if offer else None,
        operation_number=operation,
        contract_number=contract.number if contract else contract_number(record),
        amount=offer.amount if offer else record.amount,
        account_number=settlement_account(record.company),
        status="COMPLETED",
        simulated=True,
        actor_type=actor.type,
        actor_name=actor.name,
        created_at=at,
    )
    record.disbursement = disbursement
    set_status(db, record, "DISBURSED", at, actor, "Средства перечислены на расчётный счёт")
    notify(
        db,
        record,
        "DISBURSED",
        "Средства зачислены на расчётный счёт",
        f"{money(disbursement.amount)} по договору {disbursement.contract_number}, операция {operation}. "
        "Выдача смоделирована — реальный платёж не проводится. График платежей — в карточке заявки.",
        at,
    )
    return disbursement


def step(db: Db, record: ApplicationRecord, at: int) -> None:
    status = record.status
    if status == "SUBMITTED":
        set_status(db, record, "VALIDATING", at, SYSTEM, STAGE_REASONS["VALIDATING"])
        notify(db, record, "STAGE_PASSED", *REVIEW_STARTED, at)
    elif status == "VALIDATING":
        validate(db, record, at)
    elif status == "ENRICHING":
        enrich(db, record, at)
    elif status == "SCORING":
        assess(db, record, at)
    elif status == "DECIDING":
        decide_automatically(db, record, at)
    elif status in OFFER_STATUSES:
        expire_offer(db, record, at)
    elif status == "SIGNED":
        disburse(db, record, at, SYSTEM)
    else:
        record.next_run_at = None


def advance(db: Db, record: ApplicationRecord, now: int) -> None:
    for _ in range(MAX_STEPS):
        due = record.next_run_at
        if due is None or due > now:
            return
        step(db, record, due)

from dataclasses import dataclass

from app.fmt import HOUR, iso
from app.models import SYSTEM_ACTOR, ApplicationRecord
from app.repo import Db
from app.schemas import (
    AppEvent,
    Application,
    ApplicationShort,
    ApplicationStatus,
    BankApplication,
    BankApplicationShort,
    BkiData,
    Decision,
    EgrulData,
    Enrichment,
    FnsData,
)
from app.scoring import compute_discrepancies


def to_application(record: ApplicationRecord) -> Application:
    decision = record.decision
    return Application(
        id=record.id,
        number=record.number,
        status=record.status,
        product=record.product,
        amount=record.amount,
        term=record.term,
        purpose=record.purpose,
        purpose_type=record.purpose_type,
        company=record.company,
        company_confirmed=record.company_confirmed,
        financials=record.financials,
        documents=[document.model() for document in record.documents],
        consents=record.consents,
        offer=record.offer.model() if record.offer else None,
        info_request=record.info_request.model() if record.info_request else None,
        decision=decision.model() if decision else None,
        contract=record.contract.ref() if record.contract else None,
        disbursement=record.disbursement.model() if record.disbursement else None,
        previous_application_id=record.previous_application_id,
        version=record.version,
        revision=record.revision,
        created_at=iso(record.created_at),
        submitted_at=iso(record.submitted_at) if record.submitted_at is not None else None,
        updated_at=iso(record.updated_at),
    )


def to_short(record: ApplicationRecord) -> ApplicationShort:
    return ApplicationShort(
        id=record.id,
        number=record.number,
        product_code=record.product.code,
        product_name=record.product.name,
        amount=record.amount,
        term=record.term,
        status=record.status,
        created_at=iso(record.created_at),
        updated_at=iso(record.updated_at),
    )


def to_bank_short(record: ApplicationRecord) -> BankApplicationShort:
    scoring = record.scoring
    return BankApplicationShort(
        id=record.id,
        number=record.number,
        company_name=record.company.name,
        inn=record.company.inn,
        product_code=record.product.code,
        product_name=record.product.name,
        amount=record.amount,
        term=record.term,
        status=record.status,
        grade=scoring.grade if scoring else None,
        score=scoring.score if scoring else None,
        waiting_since=iso(record.stage_entered_at),
        assigned_to=record.assigned_to,
    )


def enrichment_of(record: ApplicationRecord) -> Enrichment | None:
    revision = record.current_revision
    if revision is None:
        return None
    found = {
        check.check_type: check.result
        for check in record.checks
        if check.revision_id == revision.id and check.status != "ERROR" and check.result is not None
    }
    if not {"EGRUL", "FNS", "BKI"} <= set(found):
        return None
    return Enrichment(
        egrul=EgrulData.model_validate(found["EGRUL"]),
        fns=FnsData.model_validate(found["FNS"]),
        bki=BkiData.model_validate(found["BKI"]),
    )


def to_bank_application(record: ApplicationRecord) -> BankApplication:
    enrichment = enrichment_of(record)
    return BankApplication(
        **to_application(record).model_dump(),
        enrichment=enrichment,
        scoring=record.scoring,
        recommendation=record.recommendation,
        discrepancies=compute_discrepancies(enrichment.fns, record.company, record.financials) if enrichment else [],
        assigned_to=record.assigned_to,
        assignee_id=record.assignee_id,
        checks=[check.model() for check in record.checks],
        revisions=[revision.summary() for revision in record.revisions],
        info_requests=[request.model() for request in record.info_requests],
    )


def events_of(db: Db, application_id: str) -> list[AppEvent]:
    return [event.model() for event in db.events_of(application_id)]


CLIENT_HIDDEN_STAGES: frozenset[ApplicationStatus] = frozenset({"VALIDATING", "ENRICHING", "SCORING", "DECIDING"})
CLIENT_REVIEW_REASON = "Заявку изучает кредитный специалист банка — обычно до 1 рабочего дня"
AUTOMATIC_DECISION = "SYSTEM"
BANK_SPECIALIST = "Специалист банка"
CLIENT_REASONS: dict[str, str | None] = {
    "Создан черновик заявки": None,
    "Заявка отправлена клиентом": None,
    "Клиент дополнил заявку": "Вы ответили на запрос банка",
    "Клиент принял предложение банка": "Вы приняли предложение банка",
    "Клиент отклонил предложение банка": None,
    "Заявка отменена клиентом": None,
    "Договор направлен на подписание": "Договор сформирован и ждёт подписи",
    "Договор подписан простой электронной подписью": "Вы подписали договор кодом из кабинета",
    "Договор подписан квалифицированной электронной подписью": "Вы подписали договор квалифицированной электронной подписью",
}


def client_decision(decision: Decision | None) -> Decision | None:
    if not decision or decision.type == "MANUAL_REVIEW":
        return None
    made_by = AUTOMATIC_DECISION if decision.made_by == SYSTEM_ACTOR else BANK_SPECIALIST
    return decision.model_copy(update={"made_by": made_by, "reason_codes": []})


def client_application(record: ApplicationRecord) -> Application:
    application = to_application(record)
    return application.model_copy(update={"decision": client_decision(application.decision)})


def client_events(db: Db, application_id: str) -> list[AppEvent]:
    result: list[AppEvent] = []
    for event in events_of(db, application_id):
        if event.to_status in CLIENT_HIDDEN_STAGES:
            continue
        if event.actor_type == "CLIENT":
            reason = CLIENT_REASONS.get(event.reason or "", event.reason)
            result.append(event.model_copy(update={"reason": reason}))
            continue
        reason = CLIENT_REVIEW_REASON if event.to_status == "MANUAL_REVIEW" else event.reason
        result.append(event.model_copy(update={"actor_name": "", "reason": reason}))
    return result


def review_completed(record: ApplicationRecord) -> bool:
    return record.decision is not None and record.decision.outcome in ("APPROVED", "COUNTER_OFFER", "REJECTED")


def is_automatic(record: ApplicationRecord) -> bool:
    return review_completed(record) and all(decision.actor_type == "SYSTEM" for decision in record.decisions)


@dataclass(frozen=True)
class ReviewSpan:
    hours: float
    resolved_by: str


def review_span(db: Db, record: ApplicationRecord) -> ReviewSpan | None:
    events = db.events_of(record.id)
    entered = next((event for event in events if event.to_status == "MANUAL_REVIEW"), None)
    if not entered:
        return None
    resolved = next(
        (
            event
            for event in events
            if event.from_status == "MANUAL_REVIEW"
            and event.actor_type == "UNDERWRITER"
            and event.created_at >= entered.created_at
        ),
        None,
    )
    if not resolved:
        return None
    return ReviewSpan((resolved.created_at - entered.created_at) / HOUR, resolved.actor_name)

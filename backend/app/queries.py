from dataclasses import dataclass

from app.fmt import HOUR, iso, parse_ms
from app.insights import bki_report
from app.models import SYSTEM_ACTOR, Db, StoredApplication
from app.schemas import (
    AppEvent,
    Application,
    ApplicationShort,
    ApplicationStatus,
    BankApplication,
    BankApplicationShort,
    Decision,
    Enrichment,
)
from app.scoring import compute_discrepancies


def to_short(record: StoredApplication) -> ApplicationShort:
    app = record.app
    return ApplicationShort(
        id=app.id,
        number=app.number,
        product_code=app.product.code,
        product_name=app.product.name,
        amount=app.amount,
        term=app.term,
        status=app.status,
        created_at=app.created_at,
        updated_at=app.updated_at,
    )


def to_bank_short(record: StoredApplication) -> BankApplicationShort:
    app = record.app
    return BankApplicationShort(
        id=app.id,
        number=app.number,
        company_name=app.company.name,
        inn=app.company.inn,
        product_code=app.product.code,
        product_name=app.product.name,
        amount=app.amount,
        term=app.term,
        status=app.status,
        grade=record.scoring.grade if record.scoring else None,
        score=record.scoring.score if record.scoring else None,
        waiting_since=iso(record.stage_entered_at),
        assigned_to=record.assigned_to,
    )


def to_bank_application(db: Db, record: StoredApplication, now: int) -> BankApplication:
    mc = db.find_company(record.company_id)
    enrichment = Enrichment(egrul=mc.egrul, fns=mc.fns, bki=bki_report(db, mc, now)) if mc and record.enriched else None
    return BankApplication(
        **record.app.model_dump(),
        enrichment=enrichment,
        scoring=record.scoring,
        recommendation=record.recommendation,
        discrepancies=compute_discrepancies(mc, record.app) if mc else [],
        assigned_to=record.assigned_to,
        assignee_id=record.assignee_id,
    )


def events_of(db: Db, application_id: str) -> list[AppEvent]:
    events = sorted(
        (event for event in db.events if event.application_id == application_id),
        key=lambda event: event.created_at,
    )
    return [AppEvent.model_validate(event.model_dump(exclude={"application_id"})) for event in events]


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
    "Запрошен код подтверждения": "Договор сформирован, код подтверждения — в кабинете",
    "Договор подписан простой электронной подписью": "Вы подписали договор кодом из кабинета",
}


def client_decision(decision: Decision | None) -> Decision | None:
    if not decision or decision.type == "MANUAL_REVIEW":
        return None
    made_by = AUTOMATIC_DECISION if decision.made_by == SYSTEM_ACTOR else BANK_SPECIALIST
    return decision.model_copy(update={"made_by": made_by})


def client_application(record: StoredApplication) -> Application:
    return record.app.model_copy(update={"decision": client_decision(record.app.decision)})


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


@dataclass(frozen=True)
class ReviewSpan:
    hours: float
    resolved_by: str


def review_span(db: Db, record: StoredApplication) -> ReviewSpan | None:
    events = events_of(db, record.app.id)
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
    return ReviewSpan((parse_ms(resolved.created_at) - parse_ms(entered.created_at)) / HOUR, resolved.actor_name)

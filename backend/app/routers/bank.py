import math
from typing import get_args

from fastapi import APIRouter

from app.audit import decision_summary, record_audit
from app.deps import BankCtx, Ctx
from app.errors import ApiError, not_found
from app.fmt import iso, js_round
from app.labels import FUNNEL_STATUSES, INFO_REQUEST_OPTIONS, REJECT_REASON_OPTIONS
from app.models import StoredApplication, StoredNote, uid
from app.pipeline import SYSTEM_ACTOR, DecisionInput, apply_decision, assign, disburse
from app.queries import events_of, review_span, to_bank_application, to_bank_short
from app.schemas import (
    AppEvent,
    ApplicationNote,
    BankApplication,
    BankApplicationShort,
    BankDecisionRequest,
    BankDecisionType,
    BankStats,
    FunnelItem,
    InfoRequestItem,
    NoteRequest,
)

router = APIRouter(prefix="/bank", tags=["bank"])

STATUSES = FUNNEL_STATUSES
DECISIONS: tuple[BankDecisionType, ...] = get_args(BankDecisionType)


def bank_record(ctx: Ctx, application_id: str) -> StoredApplication:
    record = ctx.db.find_application(application_id)
    if not record or record.app.status == "DRAFT":
        raise not_found()
    return record


def assigned_to_me(record: StoredApplication, ctx: Ctx) -> bool:
    return record.assignee_id == ctx.user.id or (
        record.assignee_id is None and record.assigned_to in (ctx.user.full_name, ctx.user.email)
    )


def matches_assignment(record: StoredApplication, assigned: str | None, ctx: Ctx) -> bool:
    if assigned == "me":
        return assigned_to_me(record, ctx)
    if assigned == "none":
        return record.assignee_id is None and record.assigned_to is None
    return True


def positive(value: float | None) -> float | None:
    return value if value is not None and math.isfinite(value) and value > 0 else None


@router.get("/stats", response_model=BankStats)
async def stats(ctx: BankCtx) -> BankStats:
    submitted = [record for record in ctx.db.applications if record.app.status != "DRAFT"]
    decided = [record for record in submitted if record.app.decision and record.app.decision.type != "MANUAL_REVIEW"]
    automatic = sum(1 for record in decided if record.app.decision and record.app.decision.made_by == SYSTEM_ACTOR)
    hours = [span.hours for span in (review_span(ctx.db, record) for record in submitted) if span]
    return BankStats(
        total=len(submitted),
        auto_decision_share=js_round(automatic / len(decided) * 100) / 100 if decided else 0,
        avg_amount=js_round(sum(record.app.amount for record in submitted) / len(submitted)) if submitted else 0,
        avg_review_hours=js_round(sum(hours) / len(hours) * 10) / 10 if hours else 0,
        funnel=[
            FunnelItem(status=status, count=sum(1 for record in submitted if record.app.status == status))
            for status in STATUSES
        ],
    )


@router.get("/applications", response_model=list[BankApplicationShort])
async def queue(ctx: BankCtx, status: str | None = None, assigned: str | None = None) -> list[BankApplicationShort]:
    records = [
        record
        for record in ctx.db.applications
        if record.app.status != "DRAFT"
        and (status not in STATUSES or record.app.status == status)
        and matches_assignment(record, assigned, ctx)
    ]
    return [to_bank_short(record) for record in sorted(records, key=lambda item: item.stage_entered_at)]


@router.get("/applications/{application_id}", response_model=BankApplication)
async def get_application(application_id: str, ctx: BankCtx) -> BankApplication:
    return to_bank_application(ctx.db, bank_record(ctx, application_id), ctx.now)


@router.get("/applications/{application_id}/events", response_model=list[AppEvent])
async def get_events(application_id: str, ctx: BankCtx) -> list[AppEvent]:
    return events_of(ctx.db, bank_record(ctx, application_id).app.id)


@router.post("/applications/{application_id}/assign", response_model=BankApplication)
async def take_application(application_id: str, ctx: BankCtx) -> BankApplication:
    record = bank_record(ctx, application_id)
    if record.assignee_id != ctx.user.id:
        assign(record, ctx.user)
        record.app.updated_at = iso(ctx.now)
        record_audit(
            ctx.db,
            ctx.user,
            "application.assign",
            "application",
            record.app.id,
            f"Заявка {record.app.number} взята в работу",
            ctx.now,
        )
    return to_bank_application(ctx.db, record, ctx.now)


@router.post("/applications/{application_id}/disburse", response_model=BankApplication)
async def confirm_disbursement(application_id: str, ctx: BankCtx) -> BankApplication:
    record = bank_record(ctx, application_id)
    if record.app.status != "SIGNED":
        raise ApiError(409, "INVALID_STATUS", "Выдать можно только заявку с подписанным договором")
    disburse(ctx.db, record, ctx.now, "UNDERWRITER", ctx.user.full_name)
    record_audit(
        ctx.db,
        ctx.user,
        "application.disburse",
        "application",
        record.app.id,
        f"Выдача по заявке {record.app.number} подтверждена: {record.app.amount} ₽",
        ctx.now,
    )
    return to_bank_application(ctx.db, record, ctx.now)


def notes_of(ctx: Ctx, application_id: str) -> list[ApplicationNote]:
    notes = sorted(
        (note for note in ctx.db.notes if note.application_id == application_id), key=lambda note: note.created_at
    )
    return [ApplicationNote.model_validate(note.model_dump(exclude={"application_id"})) for note in notes]


@router.get("/applications/{application_id}/notes", response_model=list[ApplicationNote])
async def get_notes(application_id: str, ctx: BankCtx) -> list[ApplicationNote]:
    return notes_of(ctx, bank_record(ctx, application_id).app.id)


@router.post("/applications/{application_id}/notes", response_model=ApplicationNote, status_code=201)
async def add_note(application_id: str, body: NoteRequest, ctx: BankCtx) -> ApplicationNote:
    record = bank_record(ctx, application_id)
    text = body.text.strip()
    if not text:
        raise ApiError(422, "VALIDATION", "Введите текст заметки")
    note = StoredNote(
        id=uid(),
        application_id=record.app.id,
        author_id=ctx.user.id,
        author_name=ctx.user.full_name,
        text=text[:2000],
        created_at=iso(ctx.now),
    )
    ctx.db.notes.append(note)
    record_audit(
        ctx.db,
        ctx.user,
        "application.note",
        "application",
        record.app.id,
        f"Заметка к заявке {record.app.number}",
        ctx.now,
    )
    return ApplicationNote.model_validate(note.model_dump(exclude={"application_id"}))


def validate_terms(record: StoredApplication, amount: float | None, term: float | None) -> None:
    product = record.app.product
    if amount is not None and not (product.min_amount <= amount <= product.max_amount):
        raise ApiError(
            422,
            "VALIDATION",
            f"Сумма должна быть в пределах продукта: {product.min_amount}–{product.max_amount} ₽",
        )
    if term is not None and not (product.min_term <= term <= product.max_term):
        raise ApiError(
            422,
            "VALIDATION",
            f"Срок должен быть в пределах продукта: {product.min_term}–{product.max_term} мес.",
        )


def info_items(codes: list[str] | None) -> list[InfoRequestItem]:
    items = [code for code in codes or [] if code]
    if not items:
        raise ApiError(422, "VALIDATION", "Отметьте, какую информацию запросить")
    return [
        INFO_REQUEST_OPTIONS[code].model_copy()
        if code in INFO_REQUEST_OPTIONS
        else InfoRequestItem(code=code, label=code, type="text")
        for code in items
    ]


DEFAULT_REASONS: dict[BankDecisionType, str] = {
    "APPROVED": "Одобрено кредитным специалистом",
    "COUNTER_OFFER": "Условия скорректированы кредитным специалистом",
    "NEED_INFO": "Нужны дополнительные сведения",
    "REJECTED": "Отказ",
}


@router.post("/applications/{application_id}/decision", response_model=BankApplication)
async def decide(application_id: str, body: BankDecisionRequest, ctx: BankCtx) -> BankApplication:
    record = bank_record(ctx, application_id)
    if record.app.status != "MANUAL_REVIEW":
        raise ApiError(409, "INVALID_STATUS", "Решение можно принять только по заявке на ручном рассмотрении")
    decision_type = next((item for item in DECISIONS if item == body.type), None)
    if not decision_type:
        raise ApiError(422, "VALIDATION", "Выберите тип решения")
    comment = body.comment.strip()
    amount = positive(body.amount)
    term = positive(body.term)
    rate = positive(body.rate)
    with_terms = decision_type in ("APPROVED", "COUNTER_OFFER")

    if decision_type == "COUNTER_OFFER" and not (amount and term and rate):
        raise ApiError(422, "VALIDATION", "Укажите сумму, срок и ставку предложения")
    if with_terms:
        validate_terms(record, amount, term)

    items = info_items(body.items) if decision_type == "NEED_INFO" else []

    reasons: list[str] = []
    if decision_type == "REJECTED":
        reason = REJECT_REASON_OPTIONS.get(body.reason_code or "")
        if not reason:
            raise ApiError(422, "VALIDATION", "Выберите причину отказа")
        reasons.append(reason)
    if comment:
        reasons.append(comment)
    if not reasons:
        reasons.append(DEFAULT_REASONS[decision_type])

    apply_decision(
        ctx.db,
        record,
        DecisionInput(
            decision_type,
            reasons,
            amount=js_round(amount) if with_terms and amount is not None else None,
            term=js_round(term) if term is not None else None,
            rate=rate,
            items=items,
            comment=comment,
        ),
        "UNDERWRITER",
        ctx.user.full_name,
        ctx.now,
    )
    if not record.assignee_id:
        assign(record, ctx.user)
    record_audit(
        ctx.db, ctx.user, "application.decision", "application", record.app.id, decision_summary(record), ctx.now
    )
    return to_bank_application(ctx.db, record, ctx.now)

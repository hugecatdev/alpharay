import re
from typing import Annotated, get_args

from fastapi import APIRouter, File, Form, Response, UploadFile

from app.annuity import build_schedule
from app.config import settings
from app.contract import contract_html, loan_terms, schedule_start
from app.deps import ClientCtx, Ctx
from app.errors import ApiError, not_found
from app.fmt import clamp, iso, js_round, parse_ms
from app.labels import MISSING_LABELS
from app.models import StoredApplication, uid
from app.pipeline import (
    CONFIRMATION_CODE,
    add_event,
    contract_number,
    ensure_contract,
    notify,
    schedule_disbursement,
    set_status,
    submit_application,
    submit_missing,
)
from app.products import okved_eligible
from app.queries import client_application, client_events, to_short
from app.schemas import (
    AppDocument,
    AppEvent,
    Application,
    ApplicationShort,
    ApplicationStatus,
    Consents,
    Contract,
    ContractRef,
    CreateApplicationRequest,
    DocumentKind,
    Financials,
    FinancialsInput,
    InfoRespondRequest,
    PatchApplicationRequest,
    Payment,
    PurposeType,
    SignConfirmRequest,
    SignResponse,
    TaxSystem,
)
from app.storage import save_upload

router = APIRouter(prefix="/applications", tags=["applications"])

PURPOSES: tuple[PurposeType, ...] = get_args(PurposeType)
DOCUMENT_KINDS: tuple[DocumentKind, ...] = get_args(DocumentKind)
TAX_SYSTEMS: tuple[TaxSystem, ...] = get_args(TaxSystem)
EDITABLE_DOCUMENTS: tuple[ApplicationStatus, ...] = ("DRAFT", "NEED_INFO")
CANCELLABLE: tuple[ApplicationStatus, ...] = (
    "DRAFT",
    "SUBMITTED",
    "VALIDATING",
    "ENRICHING",
    "SCORING",
    "DECIDING",
    "MANUAL_REVIEW",
    "NEED_INFO",
    "COUNTER_OFFER",
    "APPROVED",
)
CONTRACT_STATUSES: tuple[ApplicationStatus, ...] = ("APPROVED", "SIGNING", "SIGNED", "DISBURSED")


def as_purpose(value: str | None) -> PurposeType | None:
    return next((item for item in PURPOSES if item == value), None)


def to_int(value: float | None, fallback: int) -> int:
    return js_round(value) if value is not None else fallback


def normalize_financials(source: FinancialsInput) -> Financials:
    last = [max(0, js_round(item)) for item in source.revenue_last_3m] + [0, 0, 0]
    return Financials(
        revenue_12m=max(0, js_round(source.revenue_12m)),
        revenue_last_3m=last[:3],
        expenses_12m=max(0, js_round(source.expenses_12m)),
        net_profit_12m=js_round(source.net_profit_12m),
        monthly_debt_payments=max(0, js_round(source.monthly_debt_payments)),
        employees_count=max(0, js_round(source.employees_count)),
        tax_system=next((item for item in TAX_SYSTEMS if item == source.tax_system), "USN_6"),
    )


def owned(ctx: Ctx, application_id: str) -> StoredApplication:
    record = ctx.own_application(application_id)
    if not record:
        raise not_found()
    return record


def touch(record: StoredApplication, now: int) -> None:
    record.app.updated_at = iso(now)


@router.get("", response_model=list[ApplicationShort])
async def list_applications(ctx: ClientCtx) -> list[ApplicationShort]:
    records = ctx.db.applications_of_company(ctx.user.company_id or "")
    return [to_short(record) for record in sorted(records, key=lambda item: item.app.updated_at, reverse=True)]


@router.post("", response_model=Application, status_code=201)
async def create_application(body: CreateApplicationRequest, ctx: ClientCtx) -> Application:
    product = ctx.db.find_product(body.product_code)
    if not product or not product.active:
        raise ApiError(422, "UNKNOWN_PRODUCT", "Выберите кредитный продукт")
    mc = ctx.db.find_company(ctx.user.company_id)
    if not mc:
        raise ApiError(409, "NO_COMPANY", "Сначала добавьте компанию — заявку подаёт ИП или юрлицо")
    if not okved_eligible(product, mc.company.okved_main):
        raise ApiError(422, "PRODUCT_NOT_ELIGIBLE", "Продукт доступен только компаниям из приоритетных отраслей")
    now = ctx.now
    record = StoredApplication(
        app=Application(
            id=uid(),
            number=ctx.db.next_number(),
            status="DRAFT",
            product=product.model_copy(deep=True),
            amount=int(clamp(to_int(body.amount, product.min_amount), product.min_amount, product.max_amount)),
            term=int(clamp(to_int(body.term, product.min_term), product.min_term, product.max_term)),
            purpose=body.purpose,
            purpose_type=as_purpose(body.purpose_type) or product.purpose_types[0],
            company=mc.company.model_copy(deep=True),
            company_confirmed=False,
            financials=None,
            documents=[],
            consents=Consents(),
            offer=None,
            info_request=None,
            decision=None,
            contract=None,
            created_at=iso(now),
            submitted_at=None,
            updated_at=iso(now),
        ),
        company_id=mc.company.id,
        user_id=ctx.user.id,
        stage_entered_at=now,
    )
    ctx.db.applications.append(record)
    add_event(ctx.db, record, None, "DRAFT", "CLIENT", ctx.user.full_name, "Создан черновик заявки", now)
    return client_application(record)


@router.get("/{application_id}", response_model=Application)
async def get_application(application_id: str, ctx: ClientCtx) -> Application:
    return client_application(owned(ctx, application_id))


@router.patch("/{application_id}", response_model=Application)
async def patch_application(application_id: str, body: PatchApplicationRequest, ctx: ClientCtx) -> Application:
    record = owned(ctx, application_id)
    app = record.app
    if app.status != "DRAFT":
        raise ApiError(409, "NOT_EDITABLE", "Заявку можно менять только до отправки")
    provided = body.model_fields_set
    if body.product_code is not None and body.product_code != app.product.code:
        product = ctx.db.find_product(body.product_code)
        if not product or not product.active:
            raise ApiError(422, "UNKNOWN_PRODUCT", "Такого продукта нет")
        if not okved_eligible(product, app.company.okved_main):
            raise ApiError(422, "PRODUCT_NOT_ELIGIBLE", "Продукт доступен только компаниям из приоритетных отраслей")
        app.product = product.model_copy(deep=True)
        if not body.purpose_type and app.purpose_type and app.purpose_type not in product.purpose_types:
            app.purpose_type = product.purpose_types[0]
    if body.amount is not None:
        app.amount = js_round(body.amount)
    if body.term is not None:
        app.term = js_round(body.term)
    app.amount = int(clamp(app.amount, app.product.min_amount, app.product.max_amount))
    app.term = int(clamp(app.term, app.product.min_term, app.product.max_term))
    if body.purpose is not None:
        app.purpose = body.purpose[:500]
    if "purpose_type" in provided:
        app.purpose_type = as_purpose(body.purpose_type)
    if body.company_confirmed is not None:
        app.company_confirmed = body.company_confirmed
    if body.financials is not None:
        app.financials = normalize_financials(body.financials)
    if body.consents is not None:
        app.consents = Consents(
            bki=app.consents.bki if body.consents.bki is None else body.consents.bki,
            personal_data=app.consents.personal_data
            if body.consents.personal_data is None
            else body.consents.personal_data,
            risks=app.consents.risks if body.consents.risks is None else body.consents.risks,
        )
    mc = ctx.db.find_company(record.company_id)
    if mc:
        app.company = mc.company.model_copy(deep=True)
    touch(record, ctx.now)
    return client_application(record)


@router.post("/{application_id}/documents", response_model=AppDocument, status_code=201)
async def upload_document(
    application_id: str,
    ctx: ClientCtx,
    kind: Annotated[str, Form()] = "",
    file: Annotated[UploadFile | None, File()] = None,
) -> AppDocument:
    record = owned(ctx, application_id)
    if record.app.status not in EDITABLE_DOCUMENTS:
        raise ApiError(409, "NOT_EDITABLE", "Документы можно добавить только в черновик или по запросу банка")
    document_kind = next((item for item in DOCUMENT_KINDS if item == kind), None)
    if not document_kind:
        raise ApiError(422, "VALIDATION", "Укажите тип документа")
    if not file:
        raise ApiError(422, "VALIDATION", "Файл не выбран")
    size = file.size if file.size is not None else 0
    if size > settings.max_upload_mb * 1024 * 1024:
        raise ApiError(422, "FILE_TOO_LARGE", f"Файл больше {settings.max_upload_mb} МБ")
    document = AppDocument(
        id=uid(),
        kind=document_kind,
        filename=file.filename or "document",
        size=size,
        created_at=iso(ctx.now),
    )
    save_upload(record.app.id, document.id, file)
    record.app.documents.append(document)
    touch(record, ctx.now)
    return document


@router.delete("/{application_id}/documents/{document_id}", status_code=204)
async def delete_document(application_id: str, document_id: str, ctx: ClientCtx) -> Response:
    record = owned(ctx, application_id)
    if record.app.status not in EDITABLE_DOCUMENTS:
        raise ApiError(409, "NOT_EDITABLE", "Документы нельзя удалить после отправки заявки")
    remaining = [doc for doc in record.app.documents if doc.id != document_id]
    if len(remaining) == len(record.app.documents):
        raise not_found("Документ не найден")
    record.app.documents = remaining
    touch(record, ctx.now)
    return Response(status_code=204)


@router.post("/{application_id}/submit", response_model=Application)
async def submit(application_id: str, ctx: ClientCtx, mock_fail: int = 0) -> Application:
    record = owned(ctx, application_id)
    if record.app.status != "DRAFT":
        raise ApiError(409, "INVALID_STATUS", "Заявка уже отправлена")
    missing = submit_missing(ctx.db, record)
    if missing:
        labels = ", ".join(MISSING_LABELS.get(code, code) for code in missing)
        raise ApiError(422, "INCOMPLETE", f"Не хватает данных для отправки: {labels}.", missing)
    submit_application(ctx.db, record, ctx.user.full_name, ctx.now, mock_fail == 1)
    return client_application(record)


@router.post("/{application_id}/cancel", response_model=Application)
async def cancel(application_id: str, ctx: ClientCtx) -> Application:
    record = owned(ctx, application_id)
    if record.app.status not in CANCELLABLE:
        raise ApiError(409, "INVALID_STATUS", "Эту заявку уже нельзя отменить")
    if record.app.offer and record.app.offer.status == "PENDING":
        record.app.offer.status = "DECLINED"
    set_status(ctx.db, record, "CANCELLED", ctx.now, "CLIENT", ctx.user.full_name, "Заявка отменена клиентом")
    return client_application(record)


@router.get("/{application_id}/events", response_model=list[AppEvent])
async def events(application_id: str, ctx: ClientCtx) -> list[AppEvent]:
    return client_events(ctx.db, owned(ctx, application_id).app.id)


def parse_number(value: str) -> float | None:
    cleaned = re.sub(r"[^\d.-]", "", value)
    try:
        return float(cleaned)
    except ValueError:
        return None


@router.post("/{application_id}/info-requests/{request_id}/respond", response_model=Application)
async def respond_info(
    application_id: str,
    request_id: str,
    body: InfoRespondRequest,
    ctx: ClientCtx,
) -> Application:
    record = owned(ctx, application_id)
    request = record.app.info_request
    if record.app.status != "NEED_INFO" or not request or request.status != "OPEN":
        raise ApiError(409, "INVALID_STATUS", "Банк сейчас не ждёт дополнительной информации")
    if request.id != request_id:
        raise not_found("Запрос не найден")
    answers = {answer.code: answer for answer in reversed(body.answers)}
    missing = [
        item.label for item in request.items if not (answers.get(item.code) and answers[item.code].value.strip())
    ]
    if missing:
        raise ApiError(422, "INCOMPLETE", "Ответьте на все пункты запроса", missing)
    for item in request.items:
        if item.type != "number":
            continue
        value = parse_number(answers[item.code].value)
        if value is None or value < 0:
            raise ApiError(422, "VALIDATION", f"Введите число в поле «{item.label}»", [item.label])
        if item.code == "revenue_12m" and record.app.financials:
            record.app.financials.revenue_12m = js_round(value)
    record.info_answers = list(body.answers)
    request.status = "ANSWERED"
    record.info_round += 1
    record.enriched = False
    record.mock_fail = False
    record.mock_fail_event_done = False
    set_status(ctx.db, record, "SUBMITTED", ctx.now, "CLIENT", ctx.user.full_name, "Клиент дополнил заявку")
    notify(
        ctx.db,
        record,
        "APPLICATION_SUBMITTED",
        "Заявка дополнена",
        "Спасибо! Банк продолжил рассмотрение заявки.",
        ctx.now,
    )
    return client_application(record)


@router.post("/{application_id}/offer/accept", response_model=Application)
async def accept_offer(application_id: str, ctx: ClientCtx) -> Application:
    record = owned(ctx, application_id)
    offer = record.app.offer
    if record.app.status != "COUNTER_OFFER" or not offer:
        raise ApiError(409, "INVALID_STATUS", "Нет предложения, ожидающего ответа")
    if parse_ms(offer.valid_until) < ctx.now:
        offer.status = "EXPIRED"
        raise ApiError(409, "OFFER_EXPIRED", "Срок действия предложения истёк")
    offer.status = "ACCEPTED"
    record.app.amount = offer.amount
    record.app.term = offer.term
    record.app.contract = ContractRef(number=contract_number(record), signed_at=None)
    set_status(ctx.db, record, "APPROVED", ctx.now, "CLIENT", ctx.user.full_name, "Клиент принял предложение банка")
    return client_application(record)


@router.post("/{application_id}/offer/decline", response_model=Application)
async def decline_offer(application_id: str, ctx: ClientCtx) -> Application:
    record = owned(ctx, application_id)
    offer = record.app.offer
    if not offer or record.app.status not in ("COUNTER_OFFER", "APPROVED"):
        raise ApiError(409, "INVALID_STATUS", "Нет предложения, ожидающего ответа")
    offer.status = "DECLINED"
    set_status(
        ctx.db, record, "CLIENT_DECLINED", ctx.now, "CLIENT", ctx.user.full_name, "Клиент отклонил предложение банка"
    )
    return client_application(record)


@router.get("/{application_id}/contract", response_model=Contract)
async def get_contract(application_id: str, ctx: ClientCtx) -> Contract:
    record = owned(ctx, application_id)
    if record.app.status not in CONTRACT_STATUSES:
        raise ApiError(409, "CONTRACT_NOT_READY", "Договор будет доступен после одобрения")
    contract = ensure_contract(record)
    return Contract(number=contract.number, html=contract_html(record, ctx.now))


@router.post("/{application_id}/sign", response_model=SignResponse)
async def sign(application_id: str, ctx: ClientCtx) -> SignResponse:
    record = owned(ctx, application_id)
    if record.app.status not in ("APPROVED", "SIGNING"):
        raise ApiError(409, "INVALID_STATUS", "Подписание доступно только для одобренной заявки")
    ensure_contract(record)
    if record.app.status == "APPROVED":
        set_status(ctx.db, record, "SIGNING", ctx.now, "CLIENT", ctx.user.full_name, "Запрошен код подтверждения")
        notify(
            ctx.db,
            record,
            "CONTRACT_READY",
            "Договор готов к подписанию",
            "Подтвердите подписание кодом в кабинете.",
            ctx.now,
        )
    return SignResponse(confirmation_code=CONFIRMATION_CODE)


@router.post("/{application_id}/sign/confirm", response_model=Application)
async def confirm_sign(application_id: str, body: SignConfirmRequest, ctx: ClientCtx) -> Application:
    record = owned(ctx, application_id)
    if record.app.status != "SIGNING":
        raise ApiError(409, "INVALID_STATUS", "Сначала запросите код подтверждения")
    if body.code.strip() != CONFIRMATION_CODE:
        raise ApiError(400, "INVALID_CODE", "Неверный код подтверждения")
    app = record.app
    ensure_contract(record).signed_at = iso(ctx.now)
    if app.offer:
        app.offer.status = "ACCEPTED"
        app.amount = app.offer.amount
        app.term = app.offer.term
    set_status(
        ctx.db, record, "SIGNED", ctx.now, "CLIENT", ctx.user.full_name, "Договор подписан простой электронной подписью"
    )
    schedule_disbursement(ctx.db, record, ctx.now)
    return client_application(record)


@router.get("/{application_id}/schedule", response_model=list[Payment])
async def schedule(application_id: str, ctx: ClientCtx) -> list[Payment]:
    record = owned(ctx, application_id)
    if record.app.product.repayment == "REVOLVING":
        return []
    amount, term, rate = loan_terms(record)
    return build_schedule(amount, term, rate, schedule_start(record, ctx.now))

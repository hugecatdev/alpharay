import re
from typing import Annotated, get_args

from fastapi import APIRouter, Depends, File, Form, Header, Response, UploadFile
from fastapi.responses import JSONResponse

from app.annuity import build_schedule
from app.config import settings
from app.contract import contract_html, loan_terms, schedule_start
from app.deps import ClientCtx, Ctx
from app.errors import ApiError, not_found
from app.fmt import clamp, js_round
from app.idempotency import IdempotencyDep
from app.labels import MISSING_LABELS, RESUBMIT_STATUSES
from app.models import ApplicationRecord, DocumentRecord, OfferRecord, uid
from app.pipeline import (
    CANCELLABLE,
    CONFIRMATION_CODE,
    OFFER_STATUSES,
    accept_offer,
    actor_of,
    cancel_application,
    complete_signing,
    contract_number,
    create_draft,
    decline_offer,
    provide_info,
    start_signing,
    submit_application,
    submit_missing,
    touch,
)
from app.products import okved_eligible
from app.queries import client_application, client_events, to_short
from app.ratelimit import rate_limit
from app.schemas import (
    AcceptOfferRequest,
    AppDocument,
    AppEvent,
    Application,
    ApplicationShort,
    ApplicationStatus,
    Consents,
    Contract,
    CreateApplicationRequest,
    DocumentKind,
    Financials,
    FinancialsInput,
    InfoRespondRequest,
    PatchApplicationRequest,
    Payment,
    Product,
    PurposeType,
    SignConfirmRequest,
    SigningCertificate,
    SignKepRequest,
    SignResponse,
    TaxSystem,
)
from app.signature import certificate_problem, signing_certificates, token_certificates
from app.storage import save_upload

router = APIRouter(prefix="/applications", tags=["applications"])

PURPOSES: tuple[PurposeType, ...] = get_args(PurposeType)
DOCUMENT_KINDS: tuple[DocumentKind, ...] = get_args(DocumentKind)
TAX_SYSTEMS: tuple[TaxSystem, ...] = get_args(TaxSystem)
EDITABLE_DOCUMENTS: tuple[ApplicationStatus, ...] = ("DRAFT", "NEED_INFO")
CONTRACT_STATUSES: tuple[ApplicationStatus, ...] = (
    "APPROVED",
    "COUNTER_OFFER",
    "OFFER_ACCEPTED",
    "SIGNING",
    "SIGNED",
    "DISBURSED",
)
SIGNING_STATUSES: tuple[ApplicationStatus, ...] = ("OFFER_ACCEPTED", "SIGNING")
MOCK_FAIL_MODES = (0, 1, 2)
VERSION = re.compile(r'^(?:W/)?"?(\d+)"?$')

writes = [Depends(rate_limit("applications", 120))]
uploads = [Depends(rate_limit("uploads", 30))]

ApplicationResult = Application | JSONResponse


def as_purpose(value: str | None) -> PurposeType | None:
    return next((item for item in PURPOSES if item == value), None)


def to_int(value: float | None, fallback: int) -> int:
    return js_round(value) if value is not None else fallback


def within(product: Product, amount: float | None, term: float | None) -> tuple[int, int]:
    return (
        int(clamp(to_int(amount, product.min_amount), product.min_amount, product.max_amount)),
        int(clamp(to_int(term, product.min_term), product.min_term, product.max_term)),
    )


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


def owned(ctx: Ctx, application_id: str, lock: bool = False) -> ApplicationRecord:
    record = ctx.own_application(application_id, lock=lock)
    if not record:
        raise not_found()
    return record


def expected_version(value: str | None) -> int | None:
    if value is None or not value.strip() or value.strip() == "*":
        return None
    match = VERSION.match(value.strip())
    if not match:
        raise ApiError(422, "VALIDATION", "Заголовок If-Match должен содержать версию заявки")
    return int(match.group(1))


def tag(response: Response, record: ApplicationRecord) -> None:
    response.headers["ETag"] = f'"{record.version}"'


@router.get("", response_model=list[ApplicationShort])
def list_applications(ctx: ClientCtx) -> list[ApplicationShort]:
    records = ctx.db.applications_of_company(ctx.user.company_id or "")
    return [to_short(record) for record in sorted(records, key=lambda item: item.updated_at, reverse=True)]


@router.post("", response_model=Application, status_code=201, dependencies=writes)
def create_application(
    body: CreateApplicationRequest, ctx: ClientCtx, idempotency: IdempotencyDep
) -> ApplicationResult:
    def action() -> Application:
        product = ctx.db.find_product(body.product_code)
        if not product or not product.active:
            raise ApiError(422, "UNKNOWN_PRODUCT", "Выберите кредитный продукт")
        mc = ctx.db.find_company(ctx.user.company_id)
        if not mc:
            raise ApiError(409, "NO_COMPANY", "Сначала добавьте компанию — заявку подаёт ИП или юрлицо")
        if not okved_eligible(product, mc.okved_main):
            raise ApiError(422, "PRODUCT_NOT_ELIGIBLE", "Продукт доступен только компаниям из приоритетных отраслей")
        amount, term = within(product, body.amount, body.term)
        purpose_type = as_purpose(body.purpose_type) or product.purpose_types[0]
        record = create_draft(ctx.db, mc, product, amount, term, body.purpose, purpose_type, ctx.user, ctx.now)
        return client_application(record)

    return idempotency.run(ctx, action, 201)


@router.get("/{application_id}", response_model=Application)
def get_application(application_id: str, ctx: ClientCtx, response: Response) -> Application:
    record = owned(ctx, application_id)
    tag(response, record)
    return client_application(record)


@router.patch("/{application_id}", response_model=Application, dependencies=writes)
def patch_application(
    application_id: str,
    body: PatchApplicationRequest,
    ctx: ClientCtx,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> Application:
    record = owned(ctx, application_id, lock=True)
    if record.status != "DRAFT":
        raise ApiError(409, "NOT_EDITABLE", "Заявку можно менять только до отправки")
    expected = expected_version(if_match)
    if expected is not None and expected != record.version:
        raise ApiError(409, "VERSION_CONFLICT", "Заявка изменилась в другой вкладке — обновите страницу")
    provided = body.model_fields_set
    if body.product_code is not None and body.product_code != record.product.code:
        product = ctx.db.find_product(body.product_code)
        if not product or not product.active:
            raise ApiError(422, "UNKNOWN_PRODUCT", "Такого продукта нет")
        if not okved_eligible(product, record.company.okved_main):
            raise ApiError(422, "PRODUCT_NOT_ELIGIBLE", "Продукт доступен только компаниям из приоритетных отраслей")
        record.product = product.model_copy(deep=True)
        record.product_code = product.code
        if not body.purpose_type and record.purpose_type and record.purpose_type not in product.purpose_types:
            record.purpose_type = product.purpose_types[0]
    product = record.product
    amount = js_round(body.amount) if body.amount is not None else record.amount
    term = js_round(body.term) if body.term is not None else record.term
    record.amount = int(clamp(amount, product.min_amount, product.max_amount))
    record.term = int(clamp(term, product.min_term, product.max_term))
    if body.purpose is not None:
        record.purpose = body.purpose[:500]
    if "purpose_type" in provided:
        record.purpose_type = as_purpose(body.purpose_type)
    if body.company_confirmed is not None:
        record.company_confirmed = body.company_confirmed
    if body.financials is not None:
        record.financials = normalize_financials(body.financials)
    if body.consents is not None:
        current = record.consents
        record.consents = Consents(
            bki=current.bki if body.consents.bki is None else body.consents.bki,
            personal_data=current.personal_data if body.consents.personal_data is None else body.consents.personal_data,
            risks=current.risks if body.consents.risks is None else body.consents.risks,
        )
    mc = ctx.db.find_company(record.company_id)
    if mc:
        record.company = mc.company
    touch(record, ctx.now)
    tag(response, record)
    return client_application(record)


@router.post("/{application_id}/documents", response_model=AppDocument, status_code=201, dependencies=uploads)
def upload_document(
    application_id: str,
    ctx: ClientCtx,
    kind: Annotated[str, Form()] = "",
    file: Annotated[UploadFile | None, File()] = None,
) -> AppDocument:
    record = owned(ctx, application_id, lock=True)
    if record.status not in EDITABLE_DOCUMENTS:
        raise ApiError(409, "NOT_EDITABLE", "Документы можно добавить только в черновик или по запросу банка")
    document_kind = next((item for item in DOCUMENT_KINDS if item == kind), None)
    if not document_kind:
        raise ApiError(422, "VALIDATION", "Укажите тип документа")
    if not file:
        raise ApiError(422, "VALIDATION", "Файл не выбран")
    limit = settings.max_upload_mb * 1024 * 1024
    if (file.size or 0) > limit:
        raise ApiError(422, "FILE_TOO_LARGE", f"Файл больше {settings.max_upload_mb} МБ")
    document_id = uid()
    stored = save_upload(record.id, document_id, file)
    document = DocumentRecord(
        id=document_id,
        kind=document_kind,
        filename=(file.filename or "document")[:255],
        size=stored.size,
        media_type=file.content_type or "application/octet-stream",
        checksum=stored.checksum,
        storage_key=stored.key,
        uploaded_by=ctx.user.id,
        created_at=ctx.now,
    )
    record.documents.append(document)
    touch(record, ctx.now)
    return document.model()


@router.delete("/{application_id}/documents/{document_id}", status_code=204, dependencies=writes)
def delete_document(application_id: str, document_id: str, ctx: ClientCtx) -> Response:
    record = owned(ctx, application_id, lock=True)
    if record.status not in EDITABLE_DOCUMENTS:
        raise ApiError(409, "NOT_EDITABLE", "Документы нельзя удалить после отправки заявки")
    document = next((item for item in record.documents if item.id == document_id), None)
    if not document:
        raise not_found("Документ не найден")
    record.documents.remove(document)
    touch(record, ctx.now)
    return Response(status_code=204)


@router.post("/{application_id}/submit", response_model=Application, dependencies=writes)
def submit(application_id: str, ctx: ClientCtx, idempotency: IdempotencyDep, mock_fail: int = 0) -> ApplicationResult:
    def action() -> Application:
        record = owned(ctx, application_id, lock=True)
        if record.status != "DRAFT":
            raise ApiError(409, "INVALID_STATUS", "Заявка уже отправлена")
        if mock_fail not in MOCK_FAIL_MODES:
            raise ApiError(422, "VALIDATION", "mock_fail: 0 — без сбоя, 1 — разовый сбой БКИ, 2 — БКИ недоступно")
        missing = submit_missing(ctx.db, record)
        if missing:
            labels = ", ".join(MISSING_LABELS.get(code, code) for code in missing)
            raise ApiError(422, "INCOMPLETE", f"Не хватает данных для отправки: {labels}.", missing)
        submit_application(ctx.db, record, actor_of(ctx.user), ctx.now, mock_fail)
        return client_application(record)

    return idempotency.run(ctx, action)


@router.post("/{application_id}/cancel", response_model=Application, dependencies=writes)
def cancel(application_id: str, ctx: ClientCtx, idempotency: IdempotencyDep) -> ApplicationResult:
    def action() -> Application:
        record = owned(ctx, application_id, lock=True)
        if record.status not in CANCELLABLE:
            raise ApiError(409, "INVALID_STATUS", "Эту заявку уже нельзя отменить")
        cancel_application(ctx.db, record, actor_of(ctx.user), ctx.now)
        return client_application(record)

    return idempotency.run(ctx, action)


@router.post("/{application_id}/resubmit", response_model=Application, status_code=201, dependencies=writes)
def resubmit(application_id: str, ctx: ClientCtx, idempotency: IdempotencyDep) -> ApplicationResult:
    def action() -> Application:
        source = owned(ctx, application_id)
        if source.status not in RESUBMIT_STATUSES:
            raise ApiError(409, "INVALID_STATUS", "Повторно подать можно только закрытую заявку")
        product = ctx.db.find_product(source.product.code)
        mc = ctx.db.find_company(source.company_id)
        if not mc:
            raise ApiError(409, "NO_COMPANY", "Компания не найдена")
        if not product or not product.active or not okved_eligible(product, mc.okved_main):
            raise ApiError(409, "PRODUCT_UNAVAILABLE", "Продукт больше не выдаётся — выберите другой в новой заявке")
        amount, term = within(product, source.amount, source.term)
        record = create_draft(
            ctx.db, mc, product, amount, term, source.purpose, source.purpose_type, ctx.user, ctx.now, source
        )
        return client_application(record)

    return idempotency.run(ctx, action, 201)


@router.get("/{application_id}/events", response_model=list[AppEvent])
def events(application_id: str, ctx: ClientCtx) -> list[AppEvent]:
    return client_events(ctx.db, owned(ctx, application_id).id)


def parse_number(value: str) -> float | None:
    cleaned = re.sub(r"[^\d.-]", "", value.replace(",", "."))
    try:
        return float(cleaned)
    except ValueError:
        return None


@router.post("/{application_id}/info-requests/{request_id}/respond", response_model=Application, dependencies=writes)
def respond_info(
    application_id: str,
    request_id: str,
    body: InfoRespondRequest,
    ctx: ClientCtx,
    idempotency: IdempotencyDep,
) -> ApplicationResult:
    def action() -> Application:
        record = owned(ctx, application_id, lock=True)
        request = record.info_request
        if record.status != "NEED_INFO" or not request or request.status != "OPEN":
            raise ApiError(409, "INVALID_STATUS", "Банк сейчас не ждёт дополнительной информации")
        if request.id != request_id:
            raise not_found("Запрос не найден")
        answers = {answer.code: answer for answer in reversed(body.answers)}
        missing = [
            item.label for item in request.items if not (answers.get(item.code) and answers[item.code].value.strip())
        ]
        if missing:
            raise ApiError(422, "INCOMPLETE", "Ответьте на все пункты запроса", missing)
        documents = {key for document in record.documents for key in (document.id, document.filename)}
        financials = record.financials
        for item in request.items:
            value = answers[item.code].value.strip()
            if item.type == "document" and value not in documents:
                raise ApiError(422, "VALIDATION", f"Приложите файл: «{item.label}»", [item.label])
            if item.type != "number":
                continue
            number = parse_number(value)
            if number is None or number < 0:
                raise ApiError(422, "VALIDATION", f"Введите число в поле «{item.label}»", [item.label])
            if item.code == "revenue_12m" and financials:
                financials = financials.model_copy(update={"revenue_12m": js_round(number)})
        record.financials = financials
        provide_info(
            ctx.db,
            record,
            request,
            [answers[item.code] for item in request.items],
            actor_of(ctx.user),
            ctx.now,
        )
        return client_application(record)

    return idempotency.run(ctx, action)


def pending_offer(record: ApplicationRecord) -> OfferRecord:
    offer = record.offer
    if record.status not in OFFER_STATUSES or not offer or offer.status != "PENDING":
        raise ApiError(409, "INVALID_STATUS", "Нет предложения, ожидающего ответа")
    return offer


@router.post("/{application_id}/offer/accept", response_model=Application, dependencies=writes)
def accept(
    application_id: str,
    ctx: ClientCtx,
    idempotency: IdempotencyDep,
    body: AcceptOfferRequest | None = None,
) -> ApplicationResult:
    def action() -> Application:
        record = owned(ctx, application_id, lock=True)
        offer = pending_offer(record)
        if body and body.offer_id and body.offer_id != offer.id:
            raise ApiError(409, "OFFER_OUTDATED", "Условия обновились — проверьте актуальное предложение банка")
        if ctx.now >= offer.valid_until:
            raise ApiError(409, "OFFER_EXPIRED", "Срок действия предложения истёк")
        accept_offer(ctx.db, record, offer, actor_of(ctx.user), ctx.now)
        return client_application(record)

    return idempotency.run(ctx, action)


@router.post("/{application_id}/offer/decline", response_model=Application, dependencies=writes)
def decline(application_id: str, ctx: ClientCtx, idempotency: IdempotencyDep) -> ApplicationResult:
    def action() -> Application:
        record = owned(ctx, application_id, lock=True)
        decline_offer(ctx.db, record, pending_offer(record), actor_of(ctx.user), ctx.now)
        return client_application(record)

    return idempotency.run(ctx, action)


@router.get("/{application_id}/contract", response_model=Contract)
def get_contract(application_id: str, ctx: ClientCtx) -> Contract:
    record = owned(ctx, application_id)
    if record.status not in CONTRACT_STATUSES:
        raise ApiError(409, "CONTRACT_NOT_READY", "Договор будет доступен после одобрения")
    number = record.contract.number if record.contract else contract_number(record)
    return Contract(number=number, html=contract_html(record, ctx.now))


@router.post("/{application_id}/sign", response_model=SignResponse, dependencies=writes)
def sign(application_id: str, ctx: ClientCtx, idempotency: IdempotencyDep) -> SignResponse | JSONResponse:
    def action() -> SignResponse:
        record = owned(ctx, application_id, lock=True)
        if record.status not in SIGNING_STATUSES:
            raise ApiError(409, "INVALID_STATUS", "Подписание доступно после принятия условий банка")
        if record.status == "OFFER_ACCEPTED":
            start_signing(ctx.db, record, actor_of(ctx.user), ctx.now)
        return SignResponse(confirmation_code=CONFIRMATION_CODE)

    return idempotency.run(ctx, action)


@router.post("/{application_id}/sign/confirm", response_model=Application, dependencies=writes)
def confirm_sign(
    application_id: str, body: SignConfirmRequest, ctx: ClientCtx, idempotency: IdempotencyDep
) -> ApplicationResult:
    def action() -> Application:
        record = owned(ctx, application_id, lock=True)
        if record.status != "SIGNING":
            raise ApiError(409, "INVALID_STATUS", "Сначала запросите код подтверждения")
        if body.code.strip() != CONFIRMATION_CODE:
            raise ApiError(400, "INVALID_CODE", "Неверный код подтверждения")
        complete_signing(
            ctx.db,
            record,
            actor_of(ctx.user),
            ctx.now,
            "PEP",
            None,
            "Договор подписан простой электронной подписью",
        )
        return client_application(record)

    return idempotency.run(ctx, action)


@router.get("/{application_id}/sign/certificates", response_model=list[SigningCertificate])
def sign_certificates(application_id: str, ctx: ClientCtx) -> list[SigningCertificate]:
    record = owned(ctx, application_id)
    if record.status not in SIGNING_STATUSES:
        raise ApiError(409, "INVALID_STATUS", "Подписание доступно после принятия условий банка")
    return signing_certificates(ctx.db.seeded_at, record.company, record.company.head_name, ctx.now)


@router.post("/{application_id}/sign/kep", response_model=Application, dependencies=writes)
def sign_kep(
    application_id: str, body: SignKepRequest, ctx: ClientCtx, idempotency: IdempotencyDep
) -> ApplicationResult:
    def action() -> Application:
        record = owned(ctx, application_id, lock=True)
        if record.status != "SIGNING":
            raise ApiError(409, "INVALID_STATUS", "Сначала направьте договор на подписание")
        company = record.company
        certificate = next(
            (
                item
                for item in token_certificates(ctx.db.seeded_at, company, company.head_name)
                if item.id == body.certificate_id
            ),
            None,
        )
        if not certificate:
            raise ApiError(400, "CERTIFICATE_NOT_FOUND", "Сертификат не найден на носителе")
        problem = certificate_problem(certificate, company, ctx.now)
        if problem:
            raise ApiError(400, "CERTIFICATE_INVALID", problem)
        complete_signing(
            ctx.db,
            record,
            actor_of(ctx.user),
            ctx.now,
            "KEP",
            certificate,
            "Договор подписан квалифицированной электронной подписью",
        )
        return client_application(record)

    return idempotency.run(ctx, action)


@router.get("/{application_id}/schedule", response_model=list[Payment])
def schedule(application_id: str, ctx: ClientCtx) -> list[Payment]:
    record = owned(ctx, application_id)
    if record.product.repayment == "REVOLVING":
        return []
    amount, term, rate = loan_terms(record)
    return build_schedule(amount, term, rate, schedule_start(record, ctx.now))

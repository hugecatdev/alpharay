import re
from typing import Annotated

from fastapi import APIRouter, Query

from app.audit import record_audit
from app.deps import AdminCtx, Ctx
from app.errors import ApiError, not_found
from app.fmt import DAY, HOUR, iso, js_round, money
from app.labels import (
    APPROVED_STATUSES,
    AWAITING_CLIENT_STATUSES,
    CLOSED_BY_CLIENT_STATUSES,
    DECISION_STATUSES,
    FINAL_STATUSES,
    FUNNEL_STATUSES,
    PROCESSING_STATUSES,
)
from app.models import ApplicationRecord, ProductRecord, UserRecord, uid
from app.pipeline import assign
from app.queries import is_automatic, review_completed, review_span, to_bank_application, to_bank_short
from app.repo import Db
from app.schemas import (
    AdminApplicationRow,
    AdminDashboard,
    AssignRequest,
    AuditEntry,
    BankApplication,
    CreditPolicy,
    CreditPolicyInput,
    DashboardTotals,
    FunnelItem,
    Product,
    ProductAdmin,
    ProductCreateRequest,
    ProductPatchRequest,
    ProductStats,
    SlaBreach,
    StaffCreateRequest,
    StaffMember,
    StaffPatchRequest,
    UnderwriterStats,
)
from app.security import hash_password

router = APIRouter(prefix="/admin", tags=["admin"])

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PRODUCT_CODE = re.compile(r"^[A-Z][A-Z0-9_]{2,31}$")
MIN_PASSWORD = 6
DECISION_LABELS = {
    "APPROVED": "одобрение",
    "COUNTER_OFFER": "встречное предложение",
    "MANUAL_REVIEW": "ручное рассмотрение",
    "REJECTED": "отказ",
}


def waiting_hours(record: ApplicationRecord, now: int) -> float:
    return js_round((now - record.stage_entered_at) / HOUR * 10) / 10


def sla_breached(record: ApplicationRecord, now: int, sla_hours: int) -> bool:
    return record.status == "MANUAL_REVIEW" and waiting_hours(record, now) > sla_hours


def staff_member(db: Db, user: UserRecord) -> StaffMember:
    return StaffMember(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        position=user.position,
        active=user.active,
        active_reviews=db.active_reviews(user.id),
        decisions_total=db.decisions_by(user.id),
    )


def admin_row(ctx: Ctx, record: ApplicationRecord, sla_hours: int) -> AdminApplicationRow:
    return AdminApplicationRow(
        **to_bank_short(record).model_dump(),
        assignee_id=record.assignee_id,
        submitted_at=iso(record.submitted_at) if record.submitted_at is not None else None,
        waiting_hours=waiting_hours(record, ctx.now),
        sla_breached=sla_breached(record, ctx.now, sla_hours),
    )


def rounded(value: float, digits: int = 1) -> float:
    scale = 10**digits
    return js_round(value * scale) / scale


def minutes_to_decision(db: Db, record: ApplicationRecord) -> float | None:
    submitted = record.submitted_at
    if submitted is None:
        return None
    decided = next(
        (
            event
            for event in db.events_of(record.id)
            if event.to_status in DECISION_STATUSES and event.created_at >= submitted
        ),
        None,
    )
    if not decided:
        return None
    return (decided.created_at - submitted) / 60_000


@router.get("/dashboard", response_model=AdminDashboard)
def dashboard(
    ctx: AdminCtx,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
) -> AdminDashboard:
    db = ctx.db
    sla_hours = db.policy.manual_review_sla_hours
    since = ctx.now - days * DAY if days else None
    everything = db.applications()
    records = [record for record in everything if since is None or record.created_at >= since]
    submitted = [record for record in records if record.status != "DRAFT"]

    def count(statuses: tuple[str, ...]) -> int:
        return sum(1 for record in records if record.status in statuses)

    disbursed = [record for record in records if record.status == "DISBURSED"]
    final = [record for record in submitted if review_completed(record)]
    positive = sum(1 for record in final if record.decision and record.decision.outcome != "REJECTED")
    automatic = sum(1 for record in final if is_automatic(record))
    to_decision = [value for value in (minutes_to_decision(db, record) for record in submitted) if value is not None]
    spans = [span for span in (review_span(db, record) for record in submitted) if span]

    by_product: list[ProductStats] = []
    for product in db.products():
        items = [record for record in submitted if record.product.code == product.code]
        by_product.append(
            ProductStats(
                code=product.code,
                name=product.name,
                active=product.active,
                applications=len(items),
                approved=sum(1 for record in items if record.status in APPROVED_STATUSES),
                disbursed_amount=sum(record.amount for record in items if record.status == "DISBURSED"),
                avg_amount=js_round(sum(record.amount for record in items) / len(items)) if items else 0,
            )
        )

    underwriters: list[UnderwriterStats] = []
    for user in db.bank_staff():
        own = [span.hours for span in spans if span.resolved_by == user.full_name]
        underwriters.append(
            UnderwriterStats(
                id=user.id,
                full_name=user.full_name,
                role=user.role,
                active=user.active,
                active_reviews=db.active_reviews(user.id),
                decisions=db.decisions_by(user.id),
                avg_review_hours=rounded(sum(own) / len(own)) if own else 0,
            )
        )

    breaches = [record for record in everything if sla_breached(record, ctx.now, sla_hours)]
    return AdminDashboard(
        period_days=days,
        totals=DashboardTotals(
            applications=len(records),
            drafts=count(("DRAFT",)),
            in_progress=count(PROCESSING_STATUSES),
            manual_review=count(("MANUAL_REVIEW",)),
            awaiting_client=count(AWAITING_CLIENT_STATUSES),
            approved=count(APPROVED_STATUSES),
            rejected=count(("REJECTED",)),
            closed_by_client=count(CLOSED_BY_CLIENT_STATUSES),
            disbursed_count=len(disbursed),
            disbursed_amount=sum(record.amount for record in disbursed),
        ),
        approval_rate=rounded(positive / len(final), 2) if final else 0,
        auto_decision_share=rounded(automatic / len(final), 2) if final else 0,
        avg_time_to_decision_minutes=rounded(sum(to_decision) / len(to_decision)) if to_decision else 0,
        avg_manual_review_hours=rounded(sum(span.hours for span in spans) / len(spans)) if spans else 0,
        funnel=[
            FunnelItem(status=status, count=sum(1 for record in submitted if record.status == status))
            for status in FUNNEL_STATUSES
        ],
        by_product=by_product,
        underwriters=underwriters,
        sla_hours=sla_hours,
        sla_breaches=[
            SlaBreach(
                id=record.id,
                number=record.number,
                company_name=record.company.name,
                amount=record.amount,
                waiting_hours=waiting_hours(record, ctx.now),
                assigned_to=record.assigned_to,
            )
            for record in breaches
        ],
    )


@router.get("/applications", response_model=list[AdminApplicationRow])
def list_applications(
    ctx: AdminCtx,
    status: str | None = None,
    product_code: str | None = None,
    assignee_id: str | None = None,
    sla: Annotated[bool | None, Query(alias="sla_breached")] = None,
    q: str | None = None,
) -> list[AdminApplicationRow]:
    needle = (q or "").strip().casefold()
    sla_hours = ctx.db.policy.manual_review_sla_hours
    rows: list[AdminApplicationRow] = []
    for record in ctx.db.applications(submitted_only=True):
        if status and record.status != status:
            continue
        if product_code and record.product.code != product_code:
            continue
        if assignee_id == "none" and record.assignee_id is not None:
            continue
        if assignee_id and assignee_id != "none" and record.assignee_id != assignee_id:
            continue
        company = record.company
        if needle and not any(needle in value.casefold() for value in (record.number, company.name, company.inn)):
            continue
        row = admin_row(ctx, record, sla_hours)
        if sla is not None and row.sla_breached != sla:
            continue
        rows.append(row)
    return rows


@router.post("/applications/{application_id}/assign", response_model=BankApplication)
def reassign(application_id: str, body: AssignRequest, ctx: AdminCtx) -> BankApplication:
    record = ctx.db.find_application(application_id, lock=True)
    if not record or record.status == "DRAFT":
        raise not_found()
    if record.status in FINAL_STATUSES:
        raise ApiError(409, "INVALID_STATUS", "Заявка уже закрыта — назначать исполнителя не нужно")
    target: UserRecord | None = None
    if body.assignee_id:
        target = ctx.db.find_user(body.assignee_id)
        if not target or not target.is_bank or not target.active:
            raise ApiError(422, "VALIDATION", "Сотрудник банка не найден или заблокирован")
    assign(record, target)
    record.updated_at = ctx.now
    summary = (
        f"Заявка {record.number} назначена: {target.full_name}"
        if target
        else f"Заявка {record.number} возвращена в общую очередь"
    )
    record_audit(ctx.db, ctx.user, "application.assign", "application", record.id, summary, ctx.now)
    return to_bank_application(record)


@router.get("/staff", response_model=list[StaffMember])
def list_staff(ctx: AdminCtx) -> list[StaffMember]:
    return [staff_member(ctx.db, user) for user in ctx.db.bank_staff()]


def clean_name(value: str, field: str) -> str:
    text = value.strip()
    if not text or len(text) > 120:
        raise ApiError(422, "VALIDATION", f"Заполните поле «{field}» (до 120 символов)")
    return text


def check_password(value: str) -> str:
    if len(value) < MIN_PASSWORD:
        raise ApiError(422, "VALIDATION", f"Пароль — не короче {MIN_PASSWORD} символов")
    return value


@router.post("/staff", response_model=StaffMember, status_code=201)
def create_staff(body: StaffCreateRequest, ctx: AdminCtx) -> StaffMember:
    email = body.email.strip().lower()
    if not EMAIL.match(email):
        raise ApiError(422, "VALIDATION", "Укажите корректный email")
    if ctx.db.find_user_by_email(email):
        raise ApiError(409, "EMAIL_TAKEN", "Пользователь с таким email уже есть")
    user = UserRecord(
        id=f"u-{uid()}",
        email=email,
        full_name=clean_name(body.full_name, "ФИО"),
        role=body.role,
        position=body.position.strip()[:120]
        or ("Кредитный аналитик" if body.role == "UNDERWRITER" else "Администратор"),
        company_id=None,
        password_hash=hash_password(check_password(body.password)),
        active=True,
        created_at=ctx.now,
    )
    ctx.db.add(user)
    record_audit(
        ctx.db,
        ctx.user,
        "staff.create",
        "staff",
        user.id,
        f"Добавлен сотрудник {user.full_name} ({user.role})",
        ctx.now,
    )
    return staff_member(ctx.db, user)


@router.patch("/staff/{user_id}", response_model=StaffMember)
def update_staff(user_id: str, body: StaffPatchRequest, ctx: AdminCtx) -> StaffMember:
    user = ctx.db.find_user(user_id)
    if not user or not user.is_bank:
        raise not_found("Сотрудник не найден")
    losing_admin = user.role == "ADMIN" and (body.active is False or (body.role is not None and body.role != "ADMIN"))
    if user.id == ctx.user.id and losing_admin:
        raise ApiError(409, "SELF_LOCKOUT", "Нельзя заблокировать себя или снять с себя роль администратора")
    changes: list[str] = []
    if body.full_name is not None and body.full_name.strip() != user.full_name:
        user.full_name = clean_name(body.full_name, "ФИО")
        changes.append("ФИО")
    if body.position is not None and body.position.strip() != user.position:
        user.position = body.position.strip()[:120]
        changes.append("должность")
    if body.role is not None and body.role != user.role:
        user.role = body.role
        changes.append(f"роль {body.role}")
    if body.password is not None:
        user.password_hash = hash_password(check_password(body.password))
        changes.append("пароль")
    if body.active is not None and body.active != user.active:
        user.active = body.active
        changes.append("разблокирован" if body.active else "заблокирован")
        if not body.active:
            for record in ctx.db.assigned_to(user.id):
                if record.status in FINAL_STATUSES:
                    continue
                assign(record, None)
                record_audit(
                    ctx.db,
                    ctx.user,
                    "application.assign",
                    "application",
                    record.id,
                    f"Заявка {record.number} возвращена в общую очередь: сотрудник заблокирован",
                    ctx.now,
                )
    if changes:
        record_audit(
            ctx.db, ctx.user, "staff.update", "staff", user.id, f"{user.full_name}: {', '.join(changes)}", ctx.now
        )
    return staff_member(ctx.db, user)


def product_admin(db: Db, product: Product) -> ProductAdmin:
    items = db.applications_of_product(product.code)
    return ProductAdmin(
        **product.model_dump(),
        applications_total=sum(1 for record in items if record.status != "DRAFT"),
        applications_in_progress=sum(
            1 for record in items if record.status not in FINAL_STATUSES and record.status != "DRAFT"
        ),
        disbursed_amount=sum(record.amount for record in items if record.status == "DISBURSED"),
    )


def validate_product(product: Product) -> None:
    if not product.name.strip():
        raise ApiError(422, "VALIDATION", "Укажите название продукта")
    if product.min_amount > product.max_amount:
        raise ApiError(422, "VALIDATION", "Минимальная сумма больше максимальной")
    if product.min_term > product.max_term:
        raise ApiError(422, "VALIDATION", "Минимальный срок больше максимального")


@router.get("/products", response_model=list[ProductAdmin])
def list_products(ctx: AdminCtx) -> list[ProductAdmin]:
    return [product_admin(ctx.db, product) for product in ctx.db.products()]


@router.post("/products", response_model=ProductAdmin, status_code=201)
def create_product(body: ProductCreateRequest, ctx: AdminCtx) -> ProductAdmin:
    code = body.code.strip().upper()
    if not PRODUCT_CODE.match(code):
        raise ApiError(422, "VALIDATION", "Код продукта — латиница, цифры и «_», от 3 до 32 символов")
    if ctx.db.product_record(code):
        raise ApiError(409, "PRODUCT_EXISTS", "Продукт с таким кодом уже есть")
    product = Product(**body.model_dump(exclude={"code"}), code=code)
    product.name = product.name.strip()
    validate_product(product)
    position = max((record.position for record in ctx.db.product_records()), default=-1) + 1
    record = ProductRecord(code=code, position=position, version=1, updated_at=ctx.now)
    record.assign(product)
    ctx.db.add(record)
    record_audit(ctx.db, ctx.user, "product.create", "product", code, f"Добавлен продукт «{product.name}»", ctx.now)
    return product_admin(ctx.db, product)


PRODUCT_FIELD_LABELS = {
    "name": "название",
    "description": "описание",
    "min_amount": "мин. сумма",
    "max_amount": "макс. сумма",
    "min_term": "мин. срок",
    "max_term": "макс. срок",
    "base_rate": "ставка",
    "purpose_types": "цели",
    "requires_invoice": "счёт поставщика",
    "category": "категория",
    "collateral": "обеспечение",
    "repayment": "порядок погашения",
    "down_payment_share": "собственный аванс",
    "targeted": "целевое использование",
    "okved_prefixes": "отрасли",
    "active": "доступность",
}


@router.patch("/products/{code}", response_model=ProductAdmin)
def update_product(code: str, body: ProductPatchRequest, ctx: AdminCtx) -> ProductAdmin:
    record = ctx.db.product_record(code)
    if not record:
        raise not_found("Продукт не найден")
    current = record.model()
    changes = {
        key: value
        for key, value in body.model_dump(exclude_unset=True, exclude_none=True).items()
        if getattr(current, key) != value
    }
    if not changes:
        return product_admin(ctx.db, current)
    updated = current.model_copy(update=changes)
    validate_product(updated)
    if not updated.active and not any(product.active for product in ctx.db.products() if product.code != code):
        raise ApiError(409, "LAST_PRODUCT", "Должен остаться хотя бы один доступный продукт")
    record.assign(updated)
    record.version += 1
    record.updated_at = ctx.now
    record_audit(
        ctx.db,
        ctx.user,
        "product.update",
        "product",
        code,
        f"Продукт «{updated.name}»: {', '.join(PRODUCT_FIELD_LABELS[key] for key in changes)}",
        ctx.now,
    )
    return product_admin(ctx.db, updated)


@router.get("/policy", response_model=CreditPolicy)
def get_policy(ctx: AdminCtx) -> CreditPolicy:
    return ctx.db.policy


def policy_changes(before: CreditPolicy, after: CreditPolicyInput) -> list[str]:
    changes: list[str] = []
    if before.manual_review_amount_threshold != after.manual_review_amount_threshold:
        changes.append(
            f"порог ручного рассмотрения {money(before.manual_review_amount_threshold)} → "
            f"{money(after.manual_review_amount_threshold)}"
        )
    if before.product_review_thresholds != after.product_review_thresholds:
        changes.append("пороги по продуктам")
    for grade, rule in after.grades.items():
        old = before.grades.get(grade)
        if not old:
            continue
        if old.min_score != rule.min_score:
            changes.append(f"грейд {grade} от {old.min_score} → {rule.min_score} баллов")
        if old.auto_decision != rule.auto_decision:
            changes.append(
                f"грейд {grade}: {DECISION_LABELS[old.auto_decision]} → {DECISION_LABELS[rule.auto_decision]}"
            )
        if old.rate_markup != rule.rate_markup:
            changes.append(f"надбавка грейда {grade} {old.rate_markup} → {rule.rate_markup} п.п.")
    simple = {
        "stop_factors_decision": "решение при стоп-факторах",
        "counter_offer_share": "доля суммы во встречном предложении",
        "offer_valid_days": "срок действия предложения",
        "manual_review_sla_hours": "SLA ручного рассмотрения",
        "auto_assign": "автораспределение",
        "auto_disbursement": "автоматическая выдача",
        "max_debt_load": "предельная долговая нагрузка",
        "revenue_mismatch_percent": "допустимое расхождение выручки с ФНС, %",
        "manual_review_overdue_days": "просрочка для ручного рассмотрения, дней",
        "min_business_age_months": "минимальный срок работы бизнеса, мес.",
    }
    for key, label in simple.items():
        if getattr(before, key) != getattr(after, key):
            changes.append(f"{label}: {getattr(before, key)} → {getattr(after, key)}")
    return changes


@router.put("/policy", response_model=CreditPolicy)
def update_policy(body: CreditPolicyInput, ctx: AdminCtx) -> CreditPolicy:
    if set(body.grades) != {"A", "B", "C", "D"}:
        raise ApiError(422, "VALIDATION", "Задайте правила для всех грейдов: A, B, C, D")
    scores = [body.grades[grade].min_score for grade in ("A", "B", "C", "D")]
    if scores[3] != 0 or not scores[0] > scores[1] > scores[2] > scores[3]:
        raise ApiError(422, "VALIDATION", "Пороги грейдов должны убывать от A к C, у грейда D — 0 баллов")
    unknown = [code for code in body.product_review_thresholds if not ctx.db.product_record(code)]
    if unknown:
        raise ApiError(422, "VALIDATION", f"Неизвестные продукты в порогах: {', '.join(unknown)}")
    if any(value < 0 for value in body.product_review_thresholds.values()):
        raise ApiError(422, "VALIDATION", "Порог по продукту не может быть отрицательным")
    changes = policy_changes(ctx.db.policy, body)
    if not changes:
        return ctx.db.policy
    saved = ctx.db.save_policy(body, ctx.user, ctx.now)
    record_audit(
        ctx.db,
        ctx.user,
        "policy.update",
        "policy",
        "credit-policy",
        f"Версия {saved.version}: {'; '.join(changes)}",
        ctx.now,
    )
    return saved


@router.get("/audit", response_model=list[AuditEntry])
def audit_log(
    ctx: AdminCtx,
    entity_type: str | None = None,
    entity_id: str | None = None,
    actor_id: str | None = None,
    action: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[AuditEntry]:
    return [entry.model() for entry in ctx.db.audit(entity_type, entity_id, actor_id, action, limit)]

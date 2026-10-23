from sqlalchemy import Select, delete, func, select, update
from sqlalchemy.orm import Session

from app.models import (
    APPLICATION_NUMBERS,
    OPERATION_NUMBERS,
    ApplicationRecord,
    AuditRecord,
    ChatSessionRecord,
    CompanyRecord,
    EventRecord,
    IdempotencyRecord,
    NoteRecord,
    NotificationRecord,
    PolicyRecord,
    ProductRecord,
    SystemStateRecord,
    UserRecord,
)
from app.schemas import CreditPolicy, CreditPolicyInput, Product

SEEDED_AT = "seeded_at"


class Db:
    def __init__(self, session: Session) -> None:
        self.session = session
        self._policy: PolicyRecord | None = None

    def add(self, item: object) -> None:
        self.session.add(item)

    def flush(self) -> None:
        self.session.flush()

    def find_user(self, user_id: str | None) -> UserRecord | None:
        return self.session.get(UserRecord, user_id) if user_id else None

    def find_user_by_email(self, email: str) -> UserRecord | None:
        return self.session.scalar(select(UserRecord).where(UserRecord.email == email))

    def users(self) -> list[UserRecord]:
        return list(self.session.scalars(select(UserRecord).order_by(UserRecord.created_at, UserRecord.id)))

    def bank_staff(self) -> list[UserRecord]:
        return [user for user in self.users() if user.is_bank]

    def company_has_user(self, company_id: str) -> bool:
        return self.session.scalar(select(func.count()).where(UserRecord.company_id == company_id)) > 0

    def find_company(self, company_id: str | None) -> CompanyRecord | None:
        return self.session.get(CompanyRecord, company_id) if company_id else None

    def find_company_by_inn(self, inn: str) -> CompanyRecord | None:
        return self.session.scalar(select(CompanyRecord).where(CompanyRecord.inn == inn))

    def product_records(self) -> list[ProductRecord]:
        return list(self.session.scalars(select(ProductRecord).order_by(ProductRecord.position)))

    def product_record(self, code: str) -> ProductRecord | None:
        return self.session.get(ProductRecord, code) if code else None

    def products(self) -> list[Product]:
        return [record.model() for record in self.product_records()]

    def active_products(self) -> list[Product]:
        return [product for product in self.products() if product.active]

    def find_product(self, code: str | None) -> Product | None:
        record = self.product_record(code or "")
        return record.model() if record else None

    @property
    def policy_record(self) -> PolicyRecord:
        if self._policy is None:
            self._policy = self.session.scalar(select(PolicyRecord).order_by(PolicyRecord.version.desc()).limit(1))
        if self._policy is None:
            raise LookupError("Кредитная политика не загружена")
        return self._policy

    @property
    def policy(self) -> CreditPolicy:
        return self.policy_record.model()

    def save_policy(self, rules: CreditPolicyInput, actor: UserRecord | None, at: int) -> CreditPolicy:
        current = self.session.scalar(select(func.max(PolicyRecord.version))) or 0
        record = PolicyRecord(
            version=current + 1,
            rules=rules,
            created_at=at,
            created_by_id=actor.id if actor else None,
            created_by=actor.full_name if actor else None,
        )
        self.session.add(record)
        self._policy = record
        return record.model()

    def review_threshold(self, product_code: str) -> int:
        policy = self.policy
        return policy.product_review_thresholds.get(product_code, policy.manual_review_amount_threshold)

    def find_application(self, application_id: str | None, lock: bool = False) -> ApplicationRecord | None:
        if not application_id:
            return None
        query = select(ApplicationRecord).where(ApplicationRecord.id == application_id)
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        return self.session.scalar(query)

    def _ordered(self, query: Select[tuple[ApplicationRecord]]) -> list[ApplicationRecord]:
        return list(self.session.scalars(query.order_by(ApplicationRecord.stage_entered_at, ApplicationRecord.number)))

    def applications(self, submitted_only: bool = False) -> list[ApplicationRecord]:
        query = select(ApplicationRecord)
        if submitted_only:
            query = query.where(ApplicationRecord.status != "DRAFT")
        return self._ordered(query)

    def applications_of_company(self, company_id: str) -> list[ApplicationRecord]:
        return self._ordered(select(ApplicationRecord).where(ApplicationRecord.company_id == company_id))

    def applications_of_product(self, product_code: str) -> list[ApplicationRecord]:
        return self._ordered(select(ApplicationRecord).where(ApplicationRecord.product_code == product_code))

    def assigned_to(self, user_id: str) -> list[ApplicationRecord]:
        return self._ordered(select(ApplicationRecord).where(ApplicationRecord.assignee_id == user_id))

    def disbursed_of_company(self, company_id: str) -> list[ApplicationRecord]:
        return self._ordered(
            select(ApplicationRecord).where(
                ApplicationRecord.company_id == company_id, ApplicationRecord.status == "DISBURSED"
            )
        )

    def active_reviews(self, user_id: str) -> int:
        query = select(func.count()).where(
            ApplicationRecord.assignee_id == user_id, ApplicationRecord.status == "MANUAL_REVIEW"
        )
        return self.session.scalar(query) or 0

    def next_number(self) -> str:
        value = self.session.scalar(APPLICATION_NUMBERS.next_value().select())
        return f"КР-2026-{value:06d}"

    def next_operation(self) -> int:
        return int(self.session.scalar(OPERATION_NUMBERS.next_value().select()))

    def next_due(self, now: int) -> ApplicationRecord | None:
        query = (
            select(ApplicationRecord)
            .where(ApplicationRecord.next_run_at <= now)
            .order_by(ApplicationRecord.next_run_at)
            .limit(1)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        return self.session.scalar(query)

    def delay(self, application_id: str, until: int, failures: int) -> None:
        self.session.execute(
            update(ApplicationRecord)
            .where(ApplicationRecord.id == application_id)
            .values(next_run_at=until, failures=failures)
        )

    def queue(self, now: int) -> tuple[int, int | None]:
        query = select(func.count(), func.min(ApplicationRecord.next_run_at)).where(
            ApplicationRecord.next_run_at <= now
        )
        count, oldest = self.session.execute(query).one()
        return count or 0, oldest

    def events_of(self, application_id: str) -> list[EventRecord]:
        query = (
            select(EventRecord)
            .where(EventRecord.application_id == application_id)
            .order_by(EventRecord.created_at, EventRecord.seq)
        )
        return list(self.session.scalars(query))

    def notes_of(self, application_id: str) -> list[NoteRecord]:
        query = select(NoteRecord).where(NoteRecord.application_id == application_id).order_by(NoteRecord.seq)
        return list(self.session.scalars(query))

    def notifications_of(self, user_id: str, unread: bool = False, limit: int = 0) -> list[NotificationRecord]:
        query = select(NotificationRecord).where(NotificationRecord.user_id == user_id)
        if unread:
            query = query.where(NotificationRecord.is_read.is_(False))
        query = query.order_by(NotificationRecord.created_at.desc(), NotificationRecord.seq.desc())
        if limit > 0:
            query = query.limit(limit)
        return list(self.session.scalars(query))

    def find_notification(self, notification_id: str, user_id: str) -> NotificationRecord | None:
        query = select(NotificationRecord).where(
            NotificationRecord.id == notification_id, NotificationRecord.user_id == user_id
        )
        return self.session.scalar(query)

    def read_all(self, user_id: str, at: int) -> None:
        self.session.execute(
            update(NotificationRecord)
            .where(NotificationRecord.user_id == user_id, NotificationRecord.is_read.is_(False))
            .values(is_read=True, read_at=at)
        )

    def clear_notifications(self) -> None:
        self.session.execute(delete(NotificationRecord))

    def audit(
        self,
        entity_type: str | None = None,
        entity_id: str | None = None,
        actor_id: str | None = None,
        action: str | None = None,
        limit: int = 100,
    ) -> list[AuditRecord]:
        query = select(AuditRecord)
        if entity_type:
            query = query.where(AuditRecord.entity_type == entity_type)
        if entity_id:
            query = query.where(AuditRecord.entity_id == entity_id)
        if actor_id:
            query = query.where(AuditRecord.actor_id == actor_id)
        if action:
            query = query.where(AuditRecord.action == action)
        query = query.order_by(AuditRecord.created_at.desc(), AuditRecord.seq.desc()).limit(limit)
        return list(self.session.scalars(query))

    def decisions_by(self, user_id: str) -> int:
        query = select(func.count()).where(
            AuditRecord.action == "application.decision", AuditRecord.actor_id == user_id
        )
        return self.session.scalar(query) or 0

    def chat_session(self, session_id: str | None, user_id: str) -> ChatSessionRecord | None:
        if not session_id:
            return None
        query = select(ChatSessionRecord).where(
            ChatSessionRecord.id == session_id, ChatSessionRecord.user_id == user_id
        )
        return self.session.scalar(query)

    def idempotency(self, user_id: str, key: str) -> IdempotencyRecord | None:
        query = (
            select(IdempotencyRecord)
            .where(IdempotencyRecord.user_id == user_id, IdempotencyRecord.key == key)
            .execution_options(populate_existing=True)
        )
        return self.session.scalar(query)

    def forget_idempotency(self, before: int) -> None:
        self.session.execute(delete(IdempotencyRecord).where(IdempotencyRecord.created_at < before))

    @property
    def seeded_at(self) -> int:
        record = self.session.get(SystemStateRecord, SEEDED_AT)
        return int(record.value) if record else 0

    def set_seeded_at(self, value: int) -> None:
        self.session.merge(SystemStateRecord(key=SEEDED_AT, value=value))

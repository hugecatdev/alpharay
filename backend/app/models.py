import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import (
    ActiveLoan,
    AppEvent,
    Application,
    ApplicationNote,
    AppNotification,
    AssistantMessage,
    AuditEntry,
    BkiData,
    Company,
    CreditPolicy,
    EgrulData,
    FnsData,
    GradePolicy,
    InfoAnswer,
    Product,
    Recommendation,
    Scoring,
    TurnoverMonth,
    User,
)

SYSTEM_ACTOR = "Кредитный конвейер"

ClientKey = Literal["client1", "client2", "client3", "client4", "client5", "newcomer", "background"]


def uid() -> str:
    return str(uuid.uuid4())


class StoredUser(User):
    password_hash: str
    active: bool = True

    @property
    def is_bank(self) -> bool:
        return self.role in ("UNDERWRITER", "ADMIN")


class StoredCompany(BaseModel):
    key: ClientKey
    company: Company
    egrul: EgrulData
    fns: FnsData
    bki: BkiData
    turnover: list[TurnoverMonth]
    external_loans: list[ActiveLoan]


class StoredApplication(BaseModel):
    app: Application
    company_id: str
    user_id: str | None
    scoring: Scoring | None = None
    recommendation: Recommendation | None = None
    enriched: bool = False
    assigned_to: str | None = None
    assignee_id: str | None = None
    stage_entered_at: int
    mock_fail: bool = False
    mock_fail_event_done: bool = False
    info_round: int = 0
    info_answers: list[InfoAnswer] = Field(default_factory=list)
    disburse_at: int | None = None
    disbursed_at: str | None = None


class StoredEvent(AppEvent):
    application_id: str


class StoredNotification(AppNotification):
    user_id: str


class StoredNote(ApplicationNote):
    application_id: str


def default_policy() -> CreditPolicy:
    return CreditPolicy(
        manual_review_amount_threshold=5_000_000,
        product_review_thresholds={},
        grades={
            "A": GradePolicy(min_score=75, auto_decision="APPROVED", rate_markup=0),
            "B": GradePolicy(min_score=60, auto_decision="APPROVED", rate_markup=1.5),
            "C": GradePolicy(min_score=45, auto_decision="MANUAL_REVIEW", rate_markup=2),
            "D": GradePolicy(min_score=0, auto_decision="REJECTED", rate_markup=0),
        },
        stop_factors_decision="REJECTED",
        counter_offer_share=0.7,
        offer_valid_days=14,
        manual_review_sla_hours=8,
        auto_assign=False,
        auto_disbursement=True,
    )


class StoredSession(BaseModel):
    id: str
    user_id: str
    messages: list[AssistantMessage] = Field(default_factory=list)


class Db(BaseModel):
    version: int
    seeded_at: int
    counter: int
    users: list[StoredUser]
    companies: list[StoredCompany]
    products: list[Product]
    applications: list[StoredApplication] = Field(default_factory=list)
    events: list[StoredEvent] = Field(default_factory=list)
    notifications: list[StoredNotification] = Field(default_factory=list)
    sessions: list[StoredSession] = Field(default_factory=list)
    policy: CreditPolicy = Field(default_factory=default_policy)
    audit: list[AuditEntry] = Field(default_factory=list)
    notes: list[StoredNote] = Field(default_factory=list)

    def next_number(self) -> str:
        self.counter += 1
        return f"КР-2026-{self.counter:06d}"

    def find_user(self, user_id: str | None) -> StoredUser | None:
        return next((user for user in self.users if user.id == user_id), None)

    def find_company(self, company_id: str | None) -> StoredCompany | None:
        if not company_id:
            return None
        return next((item for item in self.companies if item.company.id == company_id), None)

    def find_company_by_inn(self, inn: str) -> StoredCompany | None:
        return next((item for item in self.companies if item.company.inn == inn), None)

    def find_application(self, application_id: str) -> StoredApplication | None:
        return next((item for item in self.applications if item.app.id == application_id), None)

    def find_product(self, code: str) -> Product | None:
        return next((product for product in self.products if product.code == code), None)

    def active_products(self) -> list[Product]:
        return [product for product in self.products if product.active]

    def bank_staff(self) -> list[StoredUser]:
        return [user for user in self.users if user.is_bank]

    def review_threshold(self, product_code: str) -> int:
        return self.policy.product_review_thresholds.get(product_code, self.policy.manual_review_amount_threshold)

    def applications_of_company(self, company_id: str) -> list[StoredApplication]:
        return [record for record in self.applications if record.company_id == company_id]


def public_user(user: StoredUser) -> User:
    return User.model_validate(user.model_dump(exclude={"password_hash"}))

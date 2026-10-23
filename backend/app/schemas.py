from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["CLIENT", "UNDERWRITER", "ADMIN"]
BankRole = Literal["UNDERWRITER", "ADMIN"]
PurposeType = Literal[
    "WORKING_CAPITAL",
    "CASH_GAP",
    "EQUIPMENT",
    "INVESTMENT",
    "REAL_ESTATE",
    "GOV_CONTRACT",
    "REFINANCING",
]
ProductCategory = Literal["WORKING", "INVESTMENT", "SPECIAL"]
Collateral = Literal["NONE", "GUARANTEE", "EQUIPMENT", "PROPERTY", "CONTRACT"]
Repayment = Literal["ANNUITY", "REVOLVING"]
TaxSystem = Literal["USN_6", "USN_15", "OSN", "PATENT"]
LegalForm = Literal["OOO", "IP"]
ApplicationStatus = Literal[
    "DRAFT",
    "SUBMITTED",
    "VALIDATING",
    "ENRICHING",
    "SCORING",
    "DECIDING",
    "APPROVED",
    "COUNTER_OFFER",
    "OFFER_ACCEPTED",
    "NEED_INFO",
    "MANUAL_REVIEW",
    "REJECTED",
    "SIGNING",
    "SIGNED",
    "DISBURSED",
    "CLIENT_DECLINED",
    "CANCELLED",
    "EXPIRED",
]
DocumentKind = Literal["BANK_STATEMENT", "TAX_RETURN", "EQUIPMENT_INVOICE", "OTHER"]
OfferStatus = Literal["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"]
InfoItemType = Literal["text", "number", "document"]
InfoRequestStatus = Literal["OPEN", "ANSWERED", "CANCELLED"]
CheckType = Literal["COMPLETENESS", "EGRUL", "FNS", "BKI", "ACCOUNT"]
CheckStatus = Literal["OK", "ISSUES", "ERROR"]
RevisionReason = Literal["SUBMITTED", "INFO_PROVIDED"]
DecisionType = Literal["APPROVED", "COUNTER_OFFER", "NEED_INFO", "MANUAL_REVIEW", "REJECTED"]
BankDecisionType = Literal["APPROVED", "COUNTER_OFFER", "NEED_INFO", "REJECTED"]
ActorType = Literal["CLIENT", "SYSTEM", "UNDERWRITER"]
NotificationType = Literal[
    "APPLICATION_SUBMITTED",
    "STAGE_PASSED",
    "INFO_REQUESTED",
    "DECISION_MADE",
    "OFFER_PENDING",
    "OFFER_EXPIRING",
    "OFFER_EXPIRED",
    "CONTRACT_READY",
    "DISBURSED",
    "PERSONAL_OFFER",
]
Grade = Literal["A", "B", "C", "D"]
SignatureType = Literal["PEP", "KEP"]
AutoDecision = Literal["APPROVED", "COUNTER_OFFER", "MANUAL_REVIEW", "REJECTED"]
AssistantFieldValue = str | int | float | bool | None


def _omit_none(value: object) -> bool:
    return value is None


class FieldError(BaseModel):
    field: str
    message: str


class ApiErrorBody(BaseModel):
    detail: str
    code: str
    missing: list[str] | None = Field(default=None, exclude_if=_omit_none)
    field_errors: list[FieldError] | None = Field(default=None, exclude_if=_omit_none)
    correlation_id: str | None = Field(default=None, exclude_if=_omit_none)


class Health(BaseModel):
    status: str


class HealthReady(BaseModel):
    status: Literal["ok", "degraded", "unavailable"]
    checks: dict[str, str]
    queue_due: int
    queue_lag_seconds: float


class User(BaseModel):
    id: str
    email: str
    full_name: str
    role: Role
    position: str
    company_id: str | None


class LoginRequest(BaseModel):
    email: str = ""
    password: str = ""


class LoginResponse(BaseModel):
    access_token: str
    user: User


class Product(BaseModel):
    code: str
    name: str
    description: str
    min_amount: int
    max_amount: int
    min_term: int
    max_term: int
    base_rate: float
    purpose_types: list[PurposeType]
    requires_invoice: bool
    category: ProductCategory = "WORKING"
    collateral: Collateral = "NONE"
    repayment: Repayment = "ANNUITY"
    down_payment_share: float = Field(default=0, ge=0, lt=1)
    targeted: bool = False
    okved_prefixes: list[str] = Field(default_factory=list)
    active: bool = True


class DemoAccount(BaseModel):
    email: str
    title: str
    description: str


class AppConfig(BaseModel):
    assistant_enabled: bool
    manual_review_amount_threshold: int
    products: list[Product]
    demo_password: str | None = None
    demo_accounts: list[DemoAccount] = Field(default_factory=list)


class Payment(BaseModel):
    date: str
    amount: int
    principal: int
    interest: int
    balance: int


class CompanyLookup(BaseModel):
    inn: str
    ogrn: str
    name: str
    legal_form: LegalForm
    registration_date: str
    okved_main: str
    okved_name: str
    address: str
    head_name: str
    tax_system: TaxSystem
    employees_count: int


class Company(CompanyLookup):
    id: str


class LinkCompanyRequest(BaseModel):
    inn: str = ""


class TurnoverMonth(BaseModel):
    month: str
    inflow: int
    outflow: int


class ActiveLoan(BaseModel):
    id: str
    contract_number: str
    product_name: str
    amount: int
    balance: int
    rate: float
    monthly_payment: int
    next_payment_date: str
    issued_at: str
    maturity_date: str


class CompanyInsights(BaseModel):
    turnover: list[TurnoverMonth]
    avg_free_cash_flow: int
    pre_approved_limit: int
    loans: list[ActiveLoan]


class ApplicationShort(BaseModel):
    id: str
    number: str
    product_code: str
    product_name: str
    amount: int
    term: int
    status: ApplicationStatus
    created_at: str
    updated_at: str


class Financials(BaseModel):
    revenue_12m: int
    revenue_last_3m: list[int]
    expenses_12m: int
    net_profit_12m: int
    monthly_debt_payments: int
    employees_count: int
    tax_system: TaxSystem


class FinancialsInput(BaseModel):
    revenue_12m: float = 0
    revenue_last_3m: list[float] = Field(default_factory=list)
    expenses_12m: float = 0
    net_profit_12m: float = 0
    monthly_debt_payments: float = 0
    employees_count: float = 0
    tax_system: str | None = None


class AppDocument(BaseModel):
    id: str
    kind: DocumentKind
    filename: str
    size: int
    created_at: str


class Consents(BaseModel):
    bki: bool = False
    personal_data: bool = False
    risks: bool = False


class ConsentsInput(BaseModel):
    bki: bool | None = None
    personal_data: bool | None = None
    risks: bool | None = None


class OfferRequested(BaseModel):
    amount: int
    term: int
    rate: float
    monthly_payment: int


class Offer(BaseModel):
    id: str
    amount: int
    term: int
    rate: float
    monthly_payment: int
    is_counter: bool
    status: OfferStatus
    valid_until: str
    requested: OfferRequested


class InfoRequestItem(BaseModel):
    code: str
    label: str
    type: InfoItemType


class InfoRequest(BaseModel):
    id: str
    items: list[InfoRequestItem]
    comment: str
    status: InfoRequestStatus


class Decision(BaseModel):
    type: DecisionType
    made_by: str
    reasons: list[str]
    reason_codes: list[str] = Field(default_factory=list)
    created_at: str


class Certificate(BaseModel):
    id: str
    serial: str
    owner_name: str
    owner_title: str
    organization: str
    inn: str
    ogrn: str
    issuer: str
    valid_from: str
    valid_to: str


class SigningCertificate(Certificate):
    problem: str | None


class ContractRef(BaseModel):
    number: str
    signed_at: str | None
    signed_with: SignatureType | None = None
    certificate: Certificate | None = None


class Disbursement(BaseModel):
    operation_number: str
    amount: int
    account_number: str
    contract_number: str
    disbursed_at: str
    simulated: bool


class Application(BaseModel):
    id: str
    number: str
    status: ApplicationStatus
    product: Product
    amount: int
    term: int
    purpose: str
    purpose_type: PurposeType | None
    company: Company
    company_confirmed: bool
    financials: Financials | None
    documents: list[AppDocument]
    consents: Consents
    offer: Offer | None
    info_request: InfoRequest | None
    decision: Decision | None
    contract: ContractRef | None
    disbursement: Disbursement | None = None
    previous_application_id: str | None = None
    version: int = 1
    revision: int = 0
    created_at: str
    submitted_at: str | None
    updated_at: str


class CreateApplicationRequest(BaseModel):
    product_code: str = ""
    amount: float | None = None
    term: float | None = None
    purpose: str = ""
    purpose_type: str | None = None


class PatchApplicationRequest(BaseModel):
    amount: float | None = None
    term: float | None = None
    purpose: str | None = None
    purpose_type: str | None = None
    product_code: str | None = None
    company_confirmed: bool | None = None
    financials: FinancialsInput | None = None
    consents: ConsentsInput | None = None


class AppEvent(BaseModel):
    id: str
    from_status: ApplicationStatus | None
    to_status: ApplicationStatus
    actor_type: ActorType
    actor_name: str
    reason: str | None
    created_at: str


class InfoAnswer(BaseModel):
    code: str
    value: str


class InfoRespondRequest(BaseModel):
    answers: list[InfoAnswer] = Field(default_factory=list)


class AcceptOfferRequest(BaseModel):
    offer_id: str | None = None


class Contract(BaseModel):
    number: str
    html: str


class SignResponse(BaseModel):
    confirmation_code: str


class SignConfirmRequest(BaseModel):
    code: str = ""


class SignKepRequest(BaseModel):
    certificate_id: str = ""


class AppNotification(BaseModel):
    id: str
    application_id: str | None
    type: NotificationType
    title: str
    body: str
    is_read: bool
    created_at: str


class AssistantContext(BaseModel):
    screen: str = "app"
    title: str = ""
    path: str = "/app"
    application_id: str | None = None
    data: dict[str, AssistantFieldValue] = Field(default_factory=dict)


class AssistantHint(BaseModel):
    target: str
    label: str


class AssistantAction(BaseModel):
    type: Literal["set_loan_params"]
    amount: int | None
    term: int | None


class AssistantMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    hints: list[AssistantHint]
    suggestions: list[str]
    actions: list[AssistantAction] = Field(default_factory=list)
    created_at: str


class AssistantChatRequest(BaseModel):
    session_id: str | None = None
    message: str = ""
    context: AssistantContext = Field(default_factory=AssistantContext)


class AssistantChatResponse(BaseModel):
    session_id: str
    message: AssistantMessage


class AssistantSession(BaseModel):
    session_id: str
    messages: list[AssistantMessage]


class BankApplicationShort(BaseModel):
    id: str
    number: str
    company_name: str
    inn: str
    product_code: str
    product_name: str
    amount: int
    term: int
    status: ApplicationStatus
    grade: Grade | None
    score: int | None
    waiting_since: str
    assigned_to: str | None


class EgrulData(BaseModel):
    status: str
    ogrn: str
    registration_date: str
    okved_main: str
    okved_name: str
    head_name: str
    address: str


class FnsData(BaseModel):
    tax_debt: int
    account_blocks: bool
    mass_address: bool
    disqualified_head: bool
    declared_revenue_12m: int


class BkiLoan(BaseModel):
    creditor: str
    amount: int
    balance: int
    opened_at: str
    closed_at: str | None
    max_overdue_days: int


class BkiData(BaseModel):
    rating: int
    rating_label: str
    active_loans: list[BkiLoan]
    closed_loans: list[BkiLoan]
    max_overdue_days_24m: int


class ScoringFactor(BaseModel):
    code: str
    name: str
    value: str
    points: int
    max_points: int
    comment: str


class Scoring(BaseModel):
    score: int
    grade: Grade
    factors: list[ScoringFactor]
    stop_factors: list[str]
    model_version: str


class Recommendation(BaseModel):
    type: DecisionType
    amount: int | None = Field(default=None, exclude_if=_omit_none)
    term: int | None = Field(default=None, exclude_if=_omit_none)
    rate: float | None = Field(default=None, exclude_if=_omit_none)
    reasons: list[str]


class Discrepancy(BaseModel):
    field: str
    label: str
    declared: int
    external: int
    diff_percent: float


class Enrichment(BaseModel):
    egrul: EgrulData
    fns: FnsData
    bki: BkiData


class CheckResult(BaseModel):
    type: CheckType
    source: str
    status: CheckStatus
    summary: str
    attempt: int
    checked_at: str


class RevisionSummary(BaseModel):
    sequence: int
    reason: RevisionReason
    author_name: str
    amount: int
    term: int
    financials: Financials | None
    answers: list[InfoAnswer]
    created_at: str


class BankApplication(Application):
    enrichment: Enrichment | None
    scoring: Scoring | None
    recommendation: Recommendation | None
    discrepancies: list[Discrepancy]
    assigned_to: str | None
    assignee_id: str | None = None
    checks: list[CheckResult] = Field(default_factory=list)
    revisions: list[RevisionSummary] = Field(default_factory=list)
    info_requests: list[InfoRequest] = Field(default_factory=list)


class BankDecisionRequest(BaseModel):
    type: str = ""
    amount: float | None = None
    term: float | None = None
    rate: float | None = None
    items: list[str] | None = None
    reason_code: str | None = None
    comment: str = ""


class FunnelItem(BaseModel):
    status: ApplicationStatus
    count: int


class BankStats(BaseModel):
    total: int
    auto_decision_share: float
    avg_amount: int
    avg_review_hours: float
    funnel: list[FunnelItem]


class ApplicationNote(BaseModel):
    id: str
    author_id: str
    author_name: str
    text: str
    created_at: str


class NoteRequest(BaseModel):
    text: str = ""


class GradePolicy(BaseModel):
    min_score: int = Field(ge=0, le=100)
    auto_decision: AutoDecision
    rate_markup: float = Field(ge=0, le=20)


class CreditPolicyInput(BaseModel):
    manual_review_amount_threshold: int = Field(ge=0)
    product_review_thresholds: dict[str, int] = Field(default_factory=dict)
    grades: dict[Grade, GradePolicy]
    stop_factors_decision: Literal["REJECTED", "MANUAL_REVIEW"]
    counter_offer_share: float = Field(ge=0.1, le=1)
    offer_valid_days: int = Field(ge=1, le=90)
    manual_review_sla_hours: int = Field(ge=1, le=240)
    auto_assign: bool
    auto_disbursement: bool
    max_debt_load: float = Field(default=0.7, ge=0.1, le=1)
    revenue_mismatch_percent: int = Field(default=20, ge=1, le=100)
    manual_review_overdue_days: int = Field(default=30, ge=0, le=365)
    min_business_age_months: int = Field(default=3, ge=0, le=120)


class CreditPolicy(CreditPolicyInput):
    version: int = 1
    updated_at: str | None = None
    updated_by: str | None = None


class AuditEntry(BaseModel):
    id: str
    created_at: str
    actor_id: str | None
    actor_name: str
    actor_role: Literal["UNDERWRITER", "ADMIN", "SYSTEM"]
    action: str
    entity_type: Literal["application", "product", "policy", "staff"]
    entity_id: str
    summary: str


class StaffMember(BaseModel):
    id: str
    email: str
    full_name: str
    role: BankRole
    position: str
    active: bool
    active_reviews: int
    decisions_total: int


class StaffCreateRequest(BaseModel):
    email: str
    full_name: str
    position: str = ""
    role: BankRole = "UNDERWRITER"
    password: str


class StaffPatchRequest(BaseModel):
    full_name: str | None = None
    position: str | None = None
    role: BankRole | None = None
    active: bool | None = None
    password: str | None = None


class ProductCreateRequest(BaseModel):
    code: str
    name: str
    description: str = ""
    min_amount: int = Field(gt=0)
    max_amount: int = Field(gt=0)
    min_term: int = Field(ge=1, le=180)
    max_term: int = Field(ge=1, le=180)
    base_rate: float = Field(gt=0, le=100)
    purpose_types: list[PurposeType] = Field(min_length=1)
    requires_invoice: bool = False
    category: ProductCategory = "WORKING"
    collateral: Collateral = "NONE"
    repayment: Repayment = "ANNUITY"
    down_payment_share: float = Field(default=0, ge=0, lt=1)
    targeted: bool = False
    okved_prefixes: list[str] = Field(default_factory=list)
    active: bool = True


class ProductPatchRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    min_amount: int | None = Field(default=None, gt=0)
    max_amount: int | None = Field(default=None, gt=0)
    min_term: int | None = Field(default=None, ge=1, le=180)
    max_term: int | None = Field(default=None, ge=1, le=180)
    base_rate: float | None = Field(default=None, gt=0, le=100)
    purpose_types: list[PurposeType] | None = Field(default=None, min_length=1)
    requires_invoice: bool | None = None
    category: ProductCategory | None = None
    collateral: Collateral | None = None
    repayment: Repayment | None = None
    down_payment_share: float | None = Field(default=None, ge=0, lt=1)
    targeted: bool | None = None
    okved_prefixes: list[str] | None = None
    active: bool | None = None


class ProductAdmin(Product):
    applications_total: int
    applications_in_progress: int
    disbursed_amount: int


class AssignRequest(BaseModel):
    assignee_id: str | None = None


class AdminApplicationRow(BankApplicationShort):
    assignee_id: str | None
    submitted_at: str | None
    waiting_hours: float
    sla_breached: bool


class DashboardTotals(BaseModel):
    applications: int
    drafts: int
    in_progress: int
    manual_review: int
    awaiting_client: int
    approved: int
    rejected: int
    closed_by_client: int
    disbursed_count: int
    disbursed_amount: int


class ProductStats(BaseModel):
    code: str
    name: str
    active: bool
    applications: int
    approved: int
    disbursed_amount: int
    avg_amount: int


class UnderwriterStats(BaseModel):
    id: str
    full_name: str
    role: BankRole
    active: bool
    active_reviews: int
    decisions: int
    avg_review_hours: float


class SlaBreach(BaseModel):
    id: str
    number: str
    company_name: str
    amount: int
    waiting_hours: float
    assigned_to: str | None


class AdminDashboard(BaseModel):
    period_days: int | None
    totals: DashboardTotals
    approval_rate: float
    auto_decision_share: float
    avg_time_to_decision_minutes: float
    avg_manual_review_hours: float
    funnel: list[FunnelItem]
    by_product: list[ProductStats]
    underwriters: list[UnderwriterStats]
    sla_hours: int
    sla_breaches: list[SlaBreach]

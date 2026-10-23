import uuid
from collections.abc import Iterable
from typing import Any, get_args

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    Sequence,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, IsoDate, Millis, Model
from app.fmt import iso
from app.schemas import (
    ActiveLoan,
    ActorType,
    AppDocument,
    AppEvent,
    ApplicationNote,
    ApplicationStatus,
    AppNotification,
    AssistantAction,
    AssistantHint,
    AssistantMessage,
    AuditEntry,
    BkiData,
    Certificate,
    CheckResult,
    CheckStatus,
    CheckType,
    Collateral,
    Company,
    Consents,
    ContractRef,
    CreditPolicy,
    CreditPolicyInput,
    Decision,
    DecisionType,
    Disbursement,
    DocumentKind,
    EgrulData,
    Financials,
    FnsData,
    Grade,
    GradePolicy,
    InfoAnswer,
    InfoRequest,
    InfoRequestItem,
    InfoRequestStatus,
    LegalForm,
    NotificationType,
    Offer,
    OfferRequested,
    OfferStatus,
    Product,
    ProductCategory,
    PurposeType,
    Recommendation,
    Repayment,
    RevisionReason,
    RevisionSummary,
    Role,
    Scoring,
    ScoringFactor,
    SignatureType,
    TaxSystem,
    TurnoverMonth,
    User,
)

SYSTEM_ACTOR = "Кредитный конвейер"

APPLICATION_NUMBERS = Sequence("application_number_seq", start=1201, metadata=Base.metadata)
OPERATION_NUMBERS = Sequence("disbursement_operation_seq", start=1, metadata=Base.metadata)


def uid() -> str:
    return str(uuid.uuid4())


def one_of(column: str, values: Iterable[str]) -> str:
    options = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({options})"


def nullable_one_of(column: str, values: Iterable[str]) -> str:
    return f"{column} IS NULL OR {one_of(column, values)}"


def literals(alias: Any) -> tuple[str, ...]:
    return get_args(alias)


class UserRecord(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(one_of("role", literals(Role)), name="role"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    email: Mapped[str] = mapped_column(Text, unique=True)
    full_name: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)
    position: Mapped[str] = mapped_column(Text, default="")
    company_id: Mapped[str | None] = mapped_column(ForeignKey("companies.id"), index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[int] = mapped_column(Millis)

    @property
    def is_bank(self) -> bool:
        return self.role in ("UNDERWRITER", "ADMIN")

    def model(self) -> User:
        return User(
            id=self.id,
            email=self.email,
            full_name=self.full_name,
            role=self.role,
            position=self.position,
            company_id=self.company_id,
        )


class CompanyRecord(Base):
    __tablename__ = "companies"
    __table_args__ = (
        CheckConstraint(one_of("legal_form", literals(LegalForm)), name="legal_form"),
        CheckConstraint(one_of("tax_system", literals(TaxSystem)), name="tax_system"),
        CheckConstraint("inn ~ '^([0-9]{10}|[0-9]{12})$'", name="inn_format"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    inn: Mapped[str] = mapped_column(Text, unique=True)
    ogrn: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    legal_form: Mapped[str] = mapped_column(Text)
    registration_date: Mapped[str] = mapped_column(IsoDate)
    okved_main: Mapped[str] = mapped_column(Text)
    okved_name: Mapped[str] = mapped_column(Text)
    address: Mapped[str] = mapped_column(Text)
    head_name: Mapped[str] = mapped_column(Text)
    tax_system: Mapped[str] = mapped_column(Text)
    employees_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[int] = mapped_column(Millis)

    source: Mapped["SourceRecord"] = relationship(lazy="selectin", cascade="all, delete-orphan")
    turnover_rows: Mapped[list["TurnoverRecord"]] = relationship(
        order_by="TurnoverRecord.month", lazy="selectin", cascade="all, delete-orphan"
    )
    loan_rows: Mapped[list["ExternalLoanRecord"]] = relationship(
        order_by="ExternalLoanRecord.issued_at", lazy="selectin", cascade="all, delete-orphan"
    )

    @property
    def company(self) -> Company:
        return Company(
            id=self.id,
            inn=self.inn,
            ogrn=self.ogrn,
            name=self.name,
            legal_form=self.legal_form,
            registration_date=self.registration_date,
            okved_main=self.okved_main,
            okved_name=self.okved_name,
            address=self.address,
            head_name=self.head_name,
            tax_system=self.tax_system,
            employees_count=self.employees_count,
        )

    @property
    def egrul(self) -> EgrulData:
        return self.source.egrul

    @property
    def fns(self) -> FnsData:
        return self.source.fns

    @property
    def bki(self) -> BkiData:
        return self.source.bki

    @property
    def turnover(self) -> list[TurnoverMonth]:
        return [row.model() for row in self.turnover_rows]

    @property
    def external_loans(self) -> list[ActiveLoan]:
        return [row.model() for row in self.loan_rows]


class SourceRecord(Base):
    __tablename__ = "company_sources"

    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    egrul: Mapped[EgrulData] = mapped_column(Model(EgrulData))
    fns: Mapped[FnsData] = mapped_column(Model(FnsData))
    bki: Mapped[BkiData] = mapped_column(Model(BkiData))
    updated_at: Mapped[int] = mapped_column(Millis)


class TurnoverRecord(Base):
    __tablename__ = "account_turnover"
    __table_args__ = (
        CheckConstraint("month ~ '^[0-9]{4}-[0-9]{2}$'", name="month_format"),
        CheckConstraint("inflow >= 0 AND outflow >= 0", name="non_negative"),
    )

    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    month: Mapped[str] = mapped_column(Text, primary_key=True)
    inflow: Mapped[int] = mapped_column(BigInteger)
    outflow: Mapped[int] = mapped_column(BigInteger)

    def model(self) -> TurnoverMonth:
        return TurnoverMonth(month=self.month, inflow=self.inflow, outflow=self.outflow)


class ExternalLoanRecord(Base):
    __tablename__ = "external_loans"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    contract_number: Mapped[str] = mapped_column(Text)
    product_name: Mapped[str] = mapped_column(Text)
    amount: Mapped[int] = mapped_column(BigInteger)
    balance: Mapped[int] = mapped_column(BigInteger)
    rate: Mapped[float] = mapped_column(Numeric(6, 3, asdecimal=False))
    monthly_payment: Mapped[int] = mapped_column(BigInteger)
    next_payment_date: Mapped[int] = mapped_column(Millis)
    issued_at: Mapped[int] = mapped_column(Millis)
    maturity_date: Mapped[int] = mapped_column(Millis)

    def model(self) -> ActiveLoan:
        return ActiveLoan(
            id=self.id,
            contract_number=self.contract_number,
            product_name=self.product_name,
            amount=self.amount,
            balance=self.balance,
            rate=self.rate,
            monthly_payment=self.monthly_payment,
            next_payment_date=iso(self.next_payment_date),
            issued_at=iso(self.issued_at),
            maturity_date=iso(self.maturity_date),
        )


class ProductRecord(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("min_amount > 0 AND min_amount <= max_amount", name="amount_range"),
        CheckConstraint("min_term > 0 AND min_term <= max_term", name="term_range"),
        CheckConstraint("base_rate > 0", name="base_rate_positive"),
        CheckConstraint("down_payment_share >= 0 AND down_payment_share < 1", name="down_payment_share"),
        CheckConstraint(one_of("category", literals(ProductCategory)), name="category"),
        CheckConstraint(one_of("collateral", literals(Collateral)), name="collateral"),
        CheckConstraint(one_of("repayment", literals(Repayment)), name="repayment"),
    )

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    min_amount: Mapped[int] = mapped_column(BigInteger)
    max_amount: Mapped[int] = mapped_column(BigInteger)
    min_term: Mapped[int] = mapped_column(Integer)
    max_term: Mapped[int] = mapped_column(Integer)
    base_rate: Mapped[float] = mapped_column(Numeric(6, 3, asdecimal=False))
    purpose_types: Mapped[list[str]] = mapped_column(ARRAY(Text))
    requires_invoice: Mapped[bool] = mapped_column(Boolean)
    category: Mapped[str] = mapped_column(Text)
    collateral: Mapped[str] = mapped_column(Text)
    repayment: Mapped[str] = mapped_column(Text)
    down_payment_share: Mapped[float] = mapped_column(Numeric(4, 3, asdecimal=False))
    targeted: Mapped[bool] = mapped_column(Boolean)
    okved_prefixes: Mapped[list[str]] = mapped_column(ARRAY(Text))
    active: Mapped[bool] = mapped_column(Boolean)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[int] = mapped_column(Millis)

    def model(self) -> Product:
        return Product(
            code=self.code,
            name=self.name,
            description=self.description,
            min_amount=self.min_amount,
            max_amount=self.max_amount,
            min_term=self.min_term,
            max_term=self.max_term,
            base_rate=self.base_rate,
            purpose_types=list(self.purpose_types),
            requires_invoice=self.requires_invoice,
            category=self.category,
            collateral=self.collateral,
            repayment=self.repayment,
            down_payment_share=self.down_payment_share,
            targeted=self.targeted,
            okved_prefixes=list(self.okved_prefixes),
            active=self.active,
        )

    def assign(self, product: Product) -> None:
        for key, value in product.model_dump(exclude={"code"}).items():
            setattr(self, key, value)


class PolicyRecord(Base):
    __tablename__ = "credit_policies"

    version: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    rules: Mapped[CreditPolicyInput] = mapped_column(Model(CreditPolicyInput))
    created_at: Mapped[int] = mapped_column(Millis)
    created_by_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_by: Mapped[str | None] = mapped_column(Text)

    def model(self) -> CreditPolicy:
        return CreditPolicy(
            **self.rules.model_dump(),
            version=self.version,
            updated_at=iso(self.created_at) if self.created_by else None,
            updated_by=self.created_by,
        )


class SystemStateRecord(Base):
    __tablename__ = "system_state"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)


class DocumentRecord(Base):
    __tablename__ = "application_documents"
    __table_args__ = (CheckConstraint(one_of("kind", literals(DocumentKind)), name="kind"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    size: Mapped[int] = mapped_column(BigInteger)
    media_type: Mapped[str] = mapped_column(Text, default="application/octet-stream")
    checksum: Mapped[str | None] = mapped_column(Text)
    storage_key: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[int] = mapped_column(Millis)

    def model(self) -> AppDocument:
        return AppDocument(
            id=self.id, kind=self.kind, filename=self.filename, size=self.size, created_at=iso(self.created_at)
        )


class RevisionRecord(Base):
    __tablename__ = "application_revisions"
    __table_args__ = (
        UniqueConstraint("application_id", "sequence"),
        CheckConstraint(one_of("reason", literals(RevisionReason)), name="reason"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    product: Mapped[Product] = mapped_column(Model(Product))
    company: Mapped[Company] = mapped_column(Model(Company))
    amount: Mapped[int] = mapped_column(BigInteger)
    term: Mapped[int] = mapped_column(Integer)
    purpose: Mapped[str] = mapped_column(Text)
    purpose_type: Mapped[str | None] = mapped_column(Text)
    financials: Mapped[Financials | None] = mapped_column(Model(Financials))
    consents: Mapped[Consents] = mapped_column(Model(Consents))
    documents: Mapped[list[AppDocument]] = mapped_column(Model(list[AppDocument]))
    answers: Mapped[list[InfoAnswer]] = mapped_column(Model(list[InfoAnswer]))
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    author_name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Millis)

    def summary(self) -> RevisionSummary:
        return RevisionSummary(
            sequence=self.sequence,
            reason=self.reason,
            author_name=self.author_name,
            amount=self.amount,
            term=self.term,
            financials=self.financials,
            answers=self.answers,
            created_at=iso(self.created_at),
        )


class CheckRecord(Base):
    __tablename__ = "check_results"
    __table_args__ = (
        CheckConstraint(one_of("check_type", literals(CheckType)), name="check_type"),
        CheckConstraint(one_of("status", literals(CheckStatus)), name="status"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("application_revisions.id", ondelete="CASCADE"), index=True)
    check_type: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    result: Mapped[Any | None] = mapped_column(JSONB)
    summary: Mapped[str] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    checked_at: Mapped[int] = mapped_column(Millis)

    revision: Mapped[RevisionRecord] = relationship()

    def model(self) -> CheckResult:
        return CheckResult(
            type=self.check_type,
            source=self.source,
            status=self.status,
            summary=self.summary,
            attempt=self.attempt,
            checked_at=iso(self.checked_at),
        )


class AssessmentRecord(Base):
    __tablename__ = "risk_assessments"
    __table_args__ = (CheckConstraint(one_of("grade", literals(Grade)), name="grade"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("application_revisions.id", ondelete="CASCADE"), index=True)
    model_version: Mapped[str] = mapped_column(Text)
    policy_version: Mapped[int] = mapped_column(Integer)
    score: Mapped[int] = mapped_column(Integer)
    grade: Mapped[str] = mapped_column(Text)
    factors: Mapped[list[ScoringFactor]] = mapped_column(Model(list[ScoringFactor]))
    stop_factors: Mapped[list[str]] = mapped_column(Model(list[str]))
    recommendation: Mapped[Recommendation] = mapped_column(Model(Recommendation))
    created_at: Mapped[int] = mapped_column(Millis)

    revision: Mapped[RevisionRecord] = relationship()

    def scoring(self) -> Scoring:
        return Scoring(
            score=self.score,
            grade=self.grade,
            factors=self.factors,
            stop_factors=self.stop_factors,
            model_version=self.model_version,
        )


class DecisionRecord(Base):
    __tablename__ = "credit_decisions"
    __table_args__ = (
        CheckConstraint(one_of("outcome", literals(DecisionType)), name="outcome"),
        CheckConstraint(one_of("actor_type", literals(ActorType)), name="actor_type"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    revision_id: Mapped[str | None] = mapped_column(ForeignKey("application_revisions.id", ondelete="CASCADE"))
    assessment_id: Mapped[str | None] = mapped_column(ForeignKey("risk_assessments.id", ondelete="SET NULL"))
    outcome: Mapped[str] = mapped_column(Text)
    reasons: Mapped[list[str]] = mapped_column(Model(list[str]))
    reason_codes: Mapped[list[str]] = mapped_column(Model(list[str]))
    comment: Mapped[str] = mapped_column(Text, default="")
    actor_type: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    actor_name: Mapped[str] = mapped_column(Text)
    policy_version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[int] = mapped_column(Millis)

    revision: Mapped[RevisionRecord | None] = relationship()
    assessment: Mapped[AssessmentRecord | None] = relationship()

    def model(self) -> Decision:
        return Decision(
            type=self.outcome,
            made_by=self.actor_name,
            reasons=list(self.reasons),
            reason_codes=list(self.reason_codes),
            created_at=iso(self.created_at),
        )


class InfoRequestRecord(Base):
    __tablename__ = "info_requests"
    __table_args__ = (CheckConstraint(one_of("status", literals(InfoRequestStatus)), name="status"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    decision_id: Mapped[str | None] = mapped_column(ForeignKey("credit_decisions.id", ondelete="SET NULL"))
    items: Mapped[list[InfoRequestItem]] = mapped_column(Model(list[InfoRequestItem]))
    comment: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(Text)
    answers: Mapped[list[InfoAnswer]] = mapped_column(Model(list[InfoAnswer]))
    reply_revision_id: Mapped[str | None] = mapped_column(ForeignKey("application_revisions.id", ondelete="SET NULL"))
    created_at: Mapped[int] = mapped_column(Millis)
    answered_at: Mapped[int | None] = mapped_column(Millis)
    answered_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))

    decision: Mapped[DecisionRecord | None] = relationship()
    reply_revision: Mapped[RevisionRecord | None] = relationship()

    def model(self) -> InfoRequest:
        return InfoRequest(id=self.id, items=list(self.items), comment=self.comment, status=self.status)


class OfferRecord(Base):
    __tablename__ = "offers"
    __table_args__ = (
        UniqueConstraint("application_id", "version"),
        CheckConstraint(one_of("status", literals(OfferStatus)), name="status"),
        CheckConstraint("amount > 0 AND term > 0 AND rate > 0", name="terms_positive"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    decision_id: Mapped[str | None] = mapped_column(ForeignKey("credit_decisions.id", ondelete="SET NULL"))
    amount: Mapped[int] = mapped_column(BigInteger)
    term: Mapped[int] = mapped_column(Integer)
    rate: Mapped[float] = mapped_column(Numeric(6, 3, asdecimal=False))
    monthly_payment: Mapped[int] = mapped_column(BigInteger)
    is_counter: Mapped[bool] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(Text)
    requested: Mapped[OfferRequested] = mapped_column(Model(OfferRequested))
    valid_until: Mapped[int] = mapped_column(Millis)
    created_at: Mapped[int] = mapped_column(Millis)
    responded_at: Mapped[int | None] = mapped_column(Millis)
    responded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))

    decision: Mapped[DecisionRecord | None] = relationship()

    def model(self) -> Offer:
        return Offer(
            id=self.id,
            amount=self.amount,
            term=self.term,
            rate=self.rate,
            monthly_payment=self.monthly_payment,
            is_counter=self.is_counter,
            status=self.status,
            valid_until=iso(self.valid_until),
            requested=self.requested,
        )


class ContractRecord(Base):
    __tablename__ = "contracts"
    __table_args__ = (CheckConstraint(nullable_one_of("signed_with", literals(SignatureType)), name="signed_with"),)

    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), primary_key=True)
    number: Mapped[str] = mapped_column(Text, unique=True)
    offer_id: Mapped[str | None] = mapped_column(ForeignKey("offers.id", ondelete="SET NULL"))
    created_at: Mapped[int] = mapped_column(Millis)
    signed_at: Mapped[int | None] = mapped_column(Millis)
    signed_with: Mapped[str | None] = mapped_column(Text)
    signed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    certificate: Mapped[Certificate | None] = mapped_column(Model(Certificate))

    offer: Mapped[OfferRecord | None] = relationship()

    def ref(self) -> ContractRef:
        return ContractRef(
            number=self.number,
            signed_at=iso(self.signed_at) if self.signed_at is not None else None,
            signed_with=self.signed_with,
            certificate=self.certificate,
        )


class DisbursementRecord(Base):
    __tablename__ = "disbursements"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), unique=True)
    offer_id: Mapped[str | None] = mapped_column(ForeignKey("offers.id", ondelete="SET NULL"))
    operation_number: Mapped[str] = mapped_column(Text, unique=True)
    contract_number: Mapped[str] = mapped_column(Text)
    amount: Mapped[int] = mapped_column(BigInteger)
    account_number: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="COMPLETED")
    simulated: Mapped[bool] = mapped_column(Boolean, default=True)
    actor_type: Mapped[str] = mapped_column(Text)
    actor_name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Millis)

    offer: Mapped[OfferRecord | None] = relationship()

    def model(self) -> Disbursement:
        return Disbursement(
            operation_number=self.operation_number,
            amount=self.amount,
            account_number=self.account_number,
            contract_number=self.contract_number,
            disbursed_at=iso(self.created_at),
            simulated=self.simulated,
        )


class ApplicationRecord(Base):
    __tablename__ = "applications"
    __table_args__ = (
        CheckConstraint(one_of("status", literals(ApplicationStatus)), name="status"),
        CheckConstraint(nullable_one_of("purpose_type", literals(PurposeType)), name="purpose_type"),
        CheckConstraint("amount > 0 AND term > 0", name="terms_positive"),
        CheckConstraint("mock_fail BETWEEN 0 AND 2", name="mock_fail"),
        Index("ix_applications_company_updated", "company_id", "updated_at"),
        Index("ix_applications_next_run_at", "next_run_at", postgresql_where=text("next_run_at IS NOT NULL")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    number: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(Text, index=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("companies.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    product_code: Mapped[str] = mapped_column(ForeignKey("products.code"), index=True)
    product: Mapped[Product] = mapped_column(Model(Product))
    company: Mapped[Company] = mapped_column(Model(Company))
    amount: Mapped[int] = mapped_column(BigInteger)
    term: Mapped[int] = mapped_column(Integer)
    purpose: Mapped[str] = mapped_column(Text, default="")
    purpose_type: Mapped[str | None] = mapped_column(Text)
    company_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    financials: Mapped[Financials | None] = mapped_column(Model(Financials))
    consents: Mapped[Consents] = mapped_column(Model(Consents))
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), index=True)
    previous_application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id"))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    mock_fail: Mapped[int] = mapped_column(SmallInteger, default=0)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    stage_entered_at: Mapped[int] = mapped_column(Millis)
    next_run_at: Mapped[int | None] = mapped_column(Millis)
    created_at: Mapped[int] = mapped_column(Millis)
    submitted_at: Mapped[int | None] = mapped_column(Millis)
    updated_at: Mapped[int] = mapped_column(Millis)

    documents: Mapped[list[DocumentRecord]] = relationship(
        order_by=DocumentRecord.created_at, lazy="selectin", cascade="all, delete-orphan"
    )
    offers: Mapped[list[OfferRecord]] = relationship(
        order_by=OfferRecord.version, lazy="selectin", cascade="all, delete-orphan"
    )
    decisions: Mapped[list[DecisionRecord]] = relationship(
        order_by=DecisionRecord.seq, lazy="selectin", cascade="all, delete-orphan"
    )
    info_requests: Mapped[list[InfoRequestRecord]] = relationship(
        order_by=InfoRequestRecord.seq, lazy="selectin", cascade="all, delete-orphan"
    )
    assessments: Mapped[list[AssessmentRecord]] = relationship(
        order_by=AssessmentRecord.created_at, lazy="selectin", cascade="all, delete-orphan"
    )
    revisions: Mapped[list[RevisionRecord]] = relationship(
        order_by=RevisionRecord.sequence, cascade="all, delete-orphan"
    )
    checks: Mapped[list[CheckRecord]] = relationship(order_by=CheckRecord.seq, cascade="all, delete-orphan")
    contract: Mapped[ContractRecord | None] = relationship(lazy="selectin", cascade="all, delete-orphan")
    disbursement: Mapped[DisbursementRecord | None] = relationship(lazy="selectin", cascade="all, delete-orphan")
    assignee: Mapped[UserRecord | None] = relationship(foreign_keys=[assignee_id], lazy="selectin")
    client: Mapped[CompanyRecord] = relationship(foreign_keys=[company_id])

    @property
    def offer(self) -> OfferRecord | None:
        return self.offers[-1] if self.offers else None

    @property
    def decision(self) -> DecisionRecord | None:
        return self.decisions[-1] if self.decisions else None

    @property
    def info_request(self) -> InfoRequestRecord | None:
        return self.info_requests[-1] if self.info_requests else None

    @property
    def assessment(self) -> AssessmentRecord | None:
        return self.assessments[-1] if self.assessments else None

    @property
    def scoring(self) -> Scoring | None:
        return self.assessment.scoring() if self.assessment else None

    @property
    def recommendation(self) -> Recommendation | None:
        return self.assessment.recommendation if self.assessment else None

    @property
    def assigned_to(self) -> str | None:
        return self.assignee.full_name if self.assignee else None

    @property
    def current_revision(self) -> RevisionRecord | None:
        return self.revisions[-1] if self.revisions else None

    @property
    def disbursed_at(self) -> int | None:
        return self.disbursement.created_at if self.disbursement else None


class EventRecord(Base):
    __tablename__ = "application_events"
    __table_args__ = (
        CheckConstraint(one_of("to_status", literals(ApplicationStatus)), name="to_status"),
        CheckConstraint(nullable_one_of("from_status", literals(ApplicationStatus)), name="from_status"),
        CheckConstraint(one_of("actor_type", literals(ActorType)), name="actor_type"),
        Index("ix_application_events_timeline", "application_id", "created_at", "seq"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    from_status: Mapped[str | None] = mapped_column(Text)
    to_status: Mapped[str] = mapped_column(Text)
    actor_type: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    actor_name: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    correlation_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Millis)

    application: Mapped[ApplicationRecord] = relationship()

    def model(self) -> AppEvent:
        return AppEvent(
            id=self.id,
            from_status=self.from_status,
            to_status=self.to_status,
            actor_type=self.actor_type,
            actor_name=self.actor_name,
            reason=self.reason,
            created_at=iso(self.created_at),
        )


class NotificationRecord(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(one_of("type", literals(NotificationType)), name="type"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    application_id: Mapped[str | None] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(Millis)
    read_at: Mapped[int | None] = mapped_column(Millis)

    application: Mapped[ApplicationRecord | None] = relationship()

    def model(self) -> AppNotification:
        return AppNotification(
            id=self.id,
            application_id=self.application_id,
            type=self.type,
            title=self.title,
            body=self.body,
            is_read=self.is_read,
            created_at=iso(self.created_at),
        )


class AuditRecord(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        CheckConstraint(one_of("actor_role", ("UNDERWRITER", "ADMIN", "SYSTEM")), name="actor_role"),
        CheckConstraint(one_of("entity_type", ("application", "product", "policy", "staff")), name="entity_type"),
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
        Index("ix_audit_log_created", "created_at", "seq"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    created_at: Mapped[int] = mapped_column(Millis)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    actor_name: Mapped[str] = mapped_column(Text)
    actor_role: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    correlation_id: Mapped[str | None] = mapped_column(Text)

    def model(self) -> AuditEntry:
        return AuditEntry(
            id=self.id,
            created_at=iso(self.created_at),
            actor_id=self.actor_id,
            actor_name=self.actor_name,
            actor_role=self.actor_role,
            action=self.action,
            entity_type=self.entity_type,
            entity_id=self.entity_id,
            summary=self.summary,
        )


class NoteRecord(Base):
    __tablename__ = "application_notes"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    author_name: Mapped[str] = mapped_column(Text)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(Millis)

    application: Mapped[ApplicationRecord] = relationship()

    def model(self) -> ApplicationNote:
        return ApplicationNote(
            id=self.id,
            author_id=self.author_id,
            author_name=self.author_name,
            text=self.text,
            created_at=iso(self.created_at),
        )


class ChatMessageRecord(Base):
    __tablename__ = "assistant_messages"
    __table_args__ = (CheckConstraint(one_of("role", ("user", "assistant")), name="role"),)

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("assistant_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    hints: Mapped[list[AssistantHint]] = mapped_column(Model(list[AssistantHint]))
    suggestions: Mapped[list[str]] = mapped_column(Model(list[str]))
    actions: Mapped[list[AssistantAction]] = mapped_column(Model(list[AssistantAction]))
    created_at: Mapped[int] = mapped_column(Millis)

    def model(self) -> AssistantMessage:
        return AssistantMessage(
            id=self.id,
            role=self.role,
            content=self.content,
            hints=list(self.hints),
            suggestions=list(self.suggestions),
            actions=list(self.actions),
            created_at=iso(self.created_at),
        )


class ChatSessionRecord(Base):
    __tablename__ = "assistant_sessions"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[int] = mapped_column(Millis)
    updated_at: Mapped[int] = mapped_column(Millis)

    messages: Mapped[list[ChatMessageRecord]] = relationship(
        order_by=ChatMessageRecord.seq, lazy="selectin", cascade="all, delete-orphan"
    )


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_keys"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(Text, primary_key=True)
    method: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text)
    request_hash: Mapped[str] = mapped_column(Text)
    status_code: Mapped[int | None] = mapped_column(Integer)
    response: Mapped[Any | None] = mapped_column(JSONB)
    created_at: Mapped[int] = mapped_column(Millis, index=True)


def default_policy() -> CreditPolicyInput:
    return CreditPolicyInput(
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
        max_debt_load=0.7,
        revenue_mismatch_percent=20,
        manual_review_overdue_days=30,
        min_business_age_months=3,
    )

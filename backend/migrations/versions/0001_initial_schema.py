from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(sa.schema.CreateSequence(sa.Sequence("application_number_seq", start=1201)))
    op.execute(sa.schema.CreateSequence(sa.Sequence("disbursement_operation_seq", start=1)))
    op.create_table(
        "companies",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("inn", sa.Text(), nullable=False),
        sa.Column("ogrn", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("legal_form", sa.Text(), nullable=False),
        sa.Column("registration_date", sa.Date(), nullable=False),
        sa.Column("okved_main", sa.Text(), nullable=False),
        sa.Column("okved_name", sa.Text(), nullable=False),
        sa.Column("address", sa.Text(), nullable=False),
        sa.Column("head_name", sa.Text(), nullable=False),
        sa.Column("tax_system", sa.Text(), nullable=False),
        sa.Column("employees_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("inn ~ '^([0-9]{10}|[0-9]{12})$'", name=op.f("ck_companies_inn_format")),
        sa.CheckConstraint("legal_form IN ('OOO', 'IP')", name=op.f("ck_companies_legal_form")),
        sa.CheckConstraint("tax_system IN ('USN_6', 'USN_15', 'OSN', 'PATENT')", name=op.f("ck_companies_tax_system")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_companies")),
        sa.UniqueConstraint("inn", name=op.f("uq_companies_inn")),
    )
    op.create_table(
        "products",
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("min_amount", sa.BigInteger(), nullable=False),
        sa.Column("max_amount", sa.BigInteger(), nullable=False),
        sa.Column("min_term", sa.Integer(), nullable=False),
        sa.Column("max_term", sa.Integer(), nullable=False),
        sa.Column("base_rate", sa.Numeric(precision=6, scale=3, asdecimal=False), nullable=False),
        sa.Column("purpose_types", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("requires_invoice", sa.Boolean(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("collateral", sa.Text(), nullable=False),
        sa.Column("repayment", sa.Text(), nullable=False),
        sa.Column("down_payment_share", sa.Numeric(precision=4, scale=3, asdecimal=False), nullable=False),
        sa.Column("targeted", sa.Boolean(), nullable=False),
        sa.Column("okved_prefixes", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("category IN ('WORKING', 'INVESTMENT', 'SPECIAL')", name=op.f("ck_products_category")),
        sa.CheckConstraint(
            "collateral IN ('NONE', 'GUARANTEE', 'EQUIPMENT', 'PROPERTY', 'CONTRACT')",
            name=op.f("ck_products_collateral"),
        ),
        sa.CheckConstraint("repayment IN ('ANNUITY', 'REVOLVING')", name=op.f("ck_products_repayment")),
        sa.CheckConstraint("base_rate > 0", name=op.f("ck_products_base_rate_positive")),
        sa.CheckConstraint(
            "down_payment_share >= 0 AND down_payment_share < 1", name=op.f("ck_products_down_payment_share")
        ),
        sa.CheckConstraint("min_amount > 0 AND min_amount <= max_amount", name=op.f("ck_products_amount_range")),
        sa.CheckConstraint("min_term > 0 AND min_term <= max_term", name=op.f("ck_products_term_range")),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_products")),
    )
    op.create_table(
        "system_state",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_system_state")),
    )
    op.create_table(
        "account_turnover",
        sa.Column("company_id", sa.Text(), nullable=False),
        sa.Column("month", sa.Text(), nullable=False),
        sa.Column("inflow", sa.BigInteger(), nullable=False),
        sa.Column("outflow", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("month ~ '^[0-9]{4}-[0-9]{2}$'", name=op.f("ck_account_turnover_month_format")),
        sa.CheckConstraint("inflow >= 0 AND outflow >= 0", name=op.f("ck_account_turnover_non_negative")),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_account_turnover_company_id_companies"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("company_id", "month", name=op.f("pk_account_turnover")),
    )
    op.create_table(
        "company_sources",
        sa.Column("company_id", sa.Text(), nullable=False),
        sa.Column("egrul", postgresql.JSONB(), nullable=False),
        sa.Column("fns", postgresql.JSONB(), nullable=False),
        sa.Column("bki", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_company_sources_company_id_companies"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("company_id", name=op.f("pk_company_sources")),
    )
    op.create_table(
        "external_loans",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.Text(), nullable=False),
        sa.Column("contract_number", sa.Text(), nullable=False),
        sa.Column("product_name", sa.Text(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("balance", sa.BigInteger(), nullable=False),
        sa.Column("rate", sa.Numeric(precision=6, scale=3, asdecimal=False), nullable=False),
        sa.Column("monthly_payment", sa.BigInteger(), nullable=False),
        sa.Column("next_payment_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("maturity_date", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_external_loans_company_id_companies"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_external_loans")),
    )
    op.create_index(op.f("ix_external_loans_company_id"), "external_loans", ["company_id"], unique=False)
    op.create_table(
        "users",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("position", sa.Text(), nullable=False),
        sa.Column("company_id", sa.Text(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('CLIENT', 'UNDERWRITER', 'ADMIN')", name=op.f("ck_users_role")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name=op.f("fk_users_company_id_companies")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_index(op.f("ix_users_company_id"), "users", ["company_id"], unique=False)
    op.create_table(
        "applications",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("number", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("company_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("product_code", sa.Text(), nullable=False),
        sa.Column("product", postgresql.JSONB(), nullable=False),
        sa.Column("company", postgresql.JSONB(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("term", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("purpose_type", sa.Text(), nullable=True),
        sa.Column("company_confirmed", sa.Boolean(), nullable=False),
        sa.Column("financials", postgresql.JSONB(), nullable=True),
        sa.Column("consents", postgresql.JSONB(), nullable=False),
        sa.Column("assignee_id", sa.Text(), nullable=True),
        sa.Column("previous_application_id", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("mock_fail", sa.SmallInteger(), nullable=False),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.Column("stage_entered_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "purpose_type IS NULL OR purpose_type IN ('WORKING_CAPITAL', 'CASH_GAP', 'EQUIPMENT', 'INVESTMENT', 'REAL_ESTATE', 'GOV_CONTRACT', 'REFINANCING')",
            name=op.f("ck_applications_purpose_type"),
        ),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'SUBMITTED', 'VALIDATING', 'ENRICHING', 'SCORING', 'DECIDING', 'APPROVED', 'COUNTER_OFFER', 'OFFER_ACCEPTED', 'NEED_INFO', 'MANUAL_REVIEW', 'REJECTED', 'SIGNING', 'SIGNED', 'DISBURSED', 'CLIENT_DECLINED', 'CANCELLED', 'EXPIRED')",
            name=op.f("ck_applications_status"),
        ),
        sa.CheckConstraint("amount > 0 AND term > 0", name=op.f("ck_applications_terms_positive")),
        sa.CheckConstraint("mock_fail BETWEEN 0 AND 2", name=op.f("ck_applications_mock_fail")),
        sa.ForeignKeyConstraint(["assignee_id"], ["users.id"], name=op.f("fk_applications_assignee_id_users")),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], name=op.f("fk_applications_company_id_companies")),
        sa.ForeignKeyConstraint(
            ["previous_application_id"],
            ["applications.id"],
            name=op.f("fk_applications_previous_application_id_applications"),
        ),
        sa.ForeignKeyConstraint(
            ["product_code"], ["products.code"], name=op.f("fk_applications_product_code_products")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_applications_user_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_applications")),
        sa.UniqueConstraint("number", name=op.f("uq_applications_number")),
    )
    op.create_index(op.f("ix_applications_assignee_id"), "applications", ["assignee_id"], unique=False)
    op.create_index(op.f("ix_applications_company_id"), "applications", ["company_id"], unique=False)
    op.create_index("ix_applications_company_updated", "applications", ["company_id", "updated_at"], unique=False)
    op.create_index(
        "ix_applications_next_run_at",
        "applications",
        ["next_run_at"],
        unique=False,
        postgresql_where=sa.text("next_run_at IS NOT NULL"),
    )
    op.create_index(op.f("ix_applications_product_code"), "applications", ["product_code"], unique=False)
    op.create_index(op.f("ix_applications_status"), "applications", ["status"], unique=False)
    op.create_table(
        "assistant_sessions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_assistant_sessions_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_sessions")),
    )
    op.create_index(op.f("ix_assistant_sessions_user_id"), "assistant_sessions", ["user_id"], unique=False)
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=True),
        sa.Column("actor_name", sa.Text(), nullable=False),
        sa.Column("actor_role", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("correlation_id", sa.Text(), nullable=True),
        sa.CheckConstraint("actor_role IN ('UNDERWRITER', 'ADMIN', 'SYSTEM')", name=op.f("ck_audit_log_actor_role")),
        sa.CheckConstraint(
            "entity_type IN ('application', 'product', 'policy', 'staff')", name=op.f("ck_audit_log_entity_type")
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], name=op.f("fk_audit_log_actor_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
        sa.UniqueConstraint("seq", name=op.f("uq_audit_log_seq")),
    )
    op.create_index("ix_audit_log_created", "audit_log", ["created_at", "seq"], unique=False)
    op.create_index("ix_audit_log_entity", "audit_log", ["entity_type", "entity_id"], unique=False)
    op.create_table(
        "credit_policies",
        sa.Column("version", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("rules", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], name=op.f("fk_credit_policies_created_by_id_users")),
        sa.PrimaryKeyConstraint("version", name=op.f("pk_credit_policies")),
    )
    op.create_table(
        "idempotency_keys",
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("request_hash", sa.Text(), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("response", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_idempotency_keys_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("user_id", "key", name=op.f("pk_idempotency_keys")),
    )
    op.create_index(op.f("ix_idempotency_keys_created_at"), "idempotency_keys", ["created_at"], unique=False)
    op.create_table(
        "application_documents",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("media_type", sa.Text(), nullable=False),
        sa.Column("checksum", sa.Text(), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('BANK_STATEMENT', 'TAX_RETURN', 'EQUIPMENT_INVOICE', 'OTHER')",
            name=op.f("ck_application_documents_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_application_documents_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], name=op.f("fk_application_documents_uploaded_by_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_application_documents")),
    )
    op.create_index(
        op.f("ix_application_documents_application_id"), "application_documents", ["application_id"], unique=False
    )
    op.create_table(
        "application_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("from_status", sa.Text(), nullable=True),
        sa.Column("to_status", sa.Text(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=True),
        sa.Column("actor_name", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("correlation_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "actor_type IN ('CLIENT', 'SYSTEM', 'UNDERWRITER')", name=op.f("ck_application_events_actor_type")
        ),
        sa.CheckConstraint(
            "from_status IS NULL OR from_status IN ('DRAFT', 'SUBMITTED', 'VALIDATING', 'ENRICHING', 'SCORING', 'DECIDING', 'APPROVED', 'COUNTER_OFFER', 'OFFER_ACCEPTED', 'NEED_INFO', 'MANUAL_REVIEW', 'REJECTED', 'SIGNING', 'SIGNED', 'DISBURSED', 'CLIENT_DECLINED', 'CANCELLED', 'EXPIRED')",
            name=op.f("ck_application_events_from_status"),
        ),
        sa.CheckConstraint(
            "to_status IN ('DRAFT', 'SUBMITTED', 'VALIDATING', 'ENRICHING', 'SCORING', 'DECIDING', 'APPROVED', 'COUNTER_OFFER', 'OFFER_ACCEPTED', 'NEED_INFO', 'MANUAL_REVIEW', 'REJECTED', 'SIGNING', 'SIGNED', 'DISBURSED', 'CLIENT_DECLINED', 'CANCELLED', 'EXPIRED')",
            name=op.f("ck_application_events_to_status"),
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], name=op.f("fk_application_events_actor_id_users")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_application_events_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_application_events")),
        sa.UniqueConstraint("seq", name=op.f("uq_application_events_seq")),
    )
    op.create_index(
        "ix_application_events_timeline", "application_events", ["application_id", "created_at", "seq"], unique=False
    )
    op.create_table(
        "application_notes",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("author_id", sa.Text(), nullable=False),
        sa.Column("author_name", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_application_notes_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], name=op.f("fk_application_notes_author_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_application_notes")),
        sa.UniqueConstraint("seq", name=op.f("uq_application_notes_seq")),
    )
    op.create_index(op.f("ix_application_notes_application_id"), "application_notes", ["application_id"], unique=False)
    op.create_table(
        "application_revisions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("product", postgresql.JSONB(), nullable=False),
        sa.Column("company", postgresql.JSONB(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("term", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("purpose_type", sa.Text(), nullable=True),
        sa.Column("financials", postgresql.JSONB(), nullable=True),
        sa.Column("consents", postgresql.JSONB(), nullable=False),
        sa.Column("documents", postgresql.JSONB(), nullable=False),
        sa.Column("answers", postgresql.JSONB(), nullable=False),
        sa.Column("author_id", sa.Text(), nullable=True),
        sa.Column("author_name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("reason IN ('SUBMITTED', 'INFO_PROVIDED')", name=op.f("ck_application_revisions_reason")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_application_revisions_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], name=op.f("fk_application_revisions_author_id_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_application_revisions")),
        sa.UniqueConstraint(
            "application_id", "sequence", name=op.f("uq_application_revisions_application_id_sequence")
        ),
    )
    op.create_index(
        op.f("ix_application_revisions_application_id"), "application_revisions", ["application_id"], unique=False
    )
    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("hints", postgresql.JSONB(), nullable=False),
        sa.Column("suggestions", postgresql.JSONB(), nullable=False),
        sa.Column("actions", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('user', 'assistant')", name=op.f("ck_assistant_messages_role")),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["assistant_sessions.id"],
            name=op.f("fk_assistant_messages_session_id_assistant_sessions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_assistant_messages")),
        sa.UniqueConstraint("seq", name=op.f("uq_assistant_messages_seq")),
    )
    op.create_index(op.f("ix_assistant_messages_session_id"), "assistant_messages", ["session_id"], unique=False)
    op.create_table(
        "notifications",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=True),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "type IN ('APPLICATION_SUBMITTED', 'STAGE_PASSED', 'INFO_REQUESTED', 'DECISION_MADE', 'OFFER_PENDING', 'OFFER_EXPIRING', 'OFFER_EXPIRED', 'CONTRACT_READY', 'DISBURSED', 'PERSONAL_OFFER')",
            name=op.f("ck_notifications_type"),
        ),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_notifications_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_notifications_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
        sa.UniqueConstraint("seq", name=op.f("uq_notifications_seq")),
    )
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"], unique=False)
    op.create_table(
        "check_results",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("revision_id", sa.Text(), nullable=False),
        sa.Column("check_type", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("result", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "check_type IN ('COMPLETENESS', 'EGRUL', 'FNS', 'BKI', 'ACCOUNT')", name=op.f("ck_check_results_check_type")
        ),
        sa.CheckConstraint("status IN ('OK', 'ISSUES', 'ERROR')", name=op.f("ck_check_results_status")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_check_results_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"],
            ["application_revisions.id"],
            name=op.f("fk_check_results_revision_id_application_revisions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_check_results")),
        sa.UniqueConstraint("seq", name=op.f("uq_check_results_seq")),
    )
    op.create_index(op.f("ix_check_results_application_id"), "check_results", ["application_id"], unique=False)
    op.create_index(op.f("ix_check_results_revision_id"), "check_results", ["revision_id"], unique=False)
    op.create_table(
        "risk_assessments",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("revision_id", sa.Text(), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("policy_version", sa.Integer(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("grade", sa.Text(), nullable=False),
        sa.Column("factors", postgresql.JSONB(), nullable=False),
        sa.Column("stop_factors", postgresql.JSONB(), nullable=False),
        sa.Column("recommendation", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("grade IN ('A', 'B', 'C', 'D')", name=op.f("ck_risk_assessments_grade")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_risk_assessments_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"],
            ["application_revisions.id"],
            name=op.f("fk_risk_assessments_revision_id_application_revisions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_risk_assessments")),
    )
    op.create_index(op.f("ix_risk_assessments_application_id"), "risk_assessments", ["application_id"], unique=False)
    op.create_index(op.f("ix_risk_assessments_revision_id"), "risk_assessments", ["revision_id"], unique=False)
    op.create_table(
        "credit_decisions",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("revision_id", sa.Text(), nullable=True),
        sa.Column("assessment_id", sa.Text(), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("reasons", postgresql.JSONB(), nullable=False),
        sa.Column("reason_codes", postgresql.JSONB(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.Text(), nullable=True),
        sa.Column("actor_name", sa.Text(), nullable=False),
        sa.Column("policy_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "actor_type IN ('CLIENT', 'SYSTEM', 'UNDERWRITER')", name=op.f("ck_credit_decisions_actor_type")
        ),
        sa.CheckConstraint(
            "outcome IN ('APPROVED', 'COUNTER_OFFER', 'NEED_INFO', 'MANUAL_REVIEW', 'REJECTED')",
            name=op.f("ck_credit_decisions_outcome"),
        ),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], name=op.f("fk_credit_decisions_actor_id_users")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_credit_decisions_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["assessment_id"],
            ["risk_assessments.id"],
            name=op.f("fk_credit_decisions_assessment_id_risk_assessments"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"],
            ["application_revisions.id"],
            name=op.f("fk_credit_decisions_revision_id_application_revisions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_credit_decisions")),
        sa.UniqueConstraint("seq", name=op.f("uq_credit_decisions_seq")),
    )
    op.create_index(op.f("ix_credit_decisions_application_id"), "credit_decisions", ["application_id"], unique=False)
    op.create_table(
        "info_requests",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("decision_id", sa.Text(), nullable=True),
        sa.Column("items", postgresql.JSONB(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("answers", postgresql.JSONB(), nullable=False),
        sa.Column("reply_revision_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("answered_by", sa.Text(), nullable=True),
        sa.CheckConstraint("status IN ('OPEN', 'ANSWERED', 'CANCELLED')", name=op.f("ck_info_requests_status")),
        sa.ForeignKeyConstraint(["answered_by"], ["users.id"], name=op.f("fk_info_requests_answered_by_users")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_info_requests_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["decision_id"],
            ["credit_decisions.id"],
            name=op.f("fk_info_requests_decision_id_credit_decisions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reply_revision_id"],
            ["application_revisions.id"],
            name=op.f("fk_info_requests_reply_revision_id_application_revisions"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_info_requests")),
        sa.UniqueConstraint("seq", name=op.f("uq_info_requests_seq")),
    )
    op.create_index(op.f("ix_info_requests_application_id"), "info_requests", ["application_id"], unique=False)
    op.create_table(
        "offers",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("decision_id", sa.Text(), nullable=True),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("term", sa.Integer(), nullable=False),
        sa.Column("rate", sa.Numeric(precision=6, scale=3, asdecimal=False), nullable=False),
        sa.Column("monthly_payment", sa.BigInteger(), nullable=False),
        sa.Column("is_counter", sa.Boolean(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("requested", postgresql.JSONB(), nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("responded_by", sa.Text(), nullable=True),
        sa.CheckConstraint("status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')", name=op.f("ck_offers_status")),
        sa.CheckConstraint("amount > 0 AND term > 0 AND rate > 0", name=op.f("ck_offers_terms_positive")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_offers_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["decision_id"],
            ["credit_decisions.id"],
            name=op.f("fk_offers_decision_id_credit_decisions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["responded_by"], ["users.id"], name=op.f("fk_offers_responded_by_users")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_offers")),
        sa.UniqueConstraint("application_id", "version", name=op.f("uq_offers_application_id_version")),
    )
    op.create_index(op.f("ix_offers_application_id"), "offers", ["application_id"], unique=False)
    op.create_table(
        "contracts",
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("number", sa.Text(), nullable=False),
        sa.Column("offer_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signed_with", sa.Text(), nullable=True),
        sa.Column("signed_by", sa.Text(), nullable=True),
        sa.Column("certificate", postgresql.JSONB(), nullable=True),
        sa.CheckConstraint(
            "signed_with IS NULL OR signed_with IN ('PEP', 'KEP')", name=op.f("ck_contracts_signed_with")
        ),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_contracts_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["offer_id"], ["offers.id"], name=op.f("fk_contracts_offer_id_offers"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["signed_by"], ["users.id"], name=op.f("fk_contracts_signed_by_users")),
        sa.PrimaryKeyConstraint("application_id", name=op.f("pk_contracts")),
        sa.UniqueConstraint("number", name=op.f("uq_contracts_number")),
    )
    op.create_table(
        "disbursements",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("application_id", sa.Text(), nullable=False),
        sa.Column("offer_id", sa.Text(), nullable=True),
        sa.Column("operation_number", sa.Text(), nullable=False),
        sa.Column("contract_number", sa.Text(), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=False),
        sa.Column("account_number", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("simulated", sa.Boolean(), nullable=False),
        sa.Column("actor_type", sa.Text(), nullable=False),
        sa.Column("actor_name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount > 0", name=op.f("ck_disbursements_amount_positive")),
        sa.ForeignKeyConstraint(
            ["application_id"],
            ["applications.id"],
            name=op.f("fk_disbursements_application_id_applications"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["offer_id"], ["offers.id"], name=op.f("fk_disbursements_offer_id_offers"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_disbursements")),
        sa.UniqueConstraint("application_id", name=op.f("uq_disbursements_application_id")),
        sa.UniqueConstraint("operation_number", name=op.f("uq_disbursements_operation_number")),
    )


def downgrade() -> None:
    op.drop_table("disbursements")
    op.drop_table("contracts")
    op.drop_index(op.f("ix_offers_application_id"), table_name="offers")
    op.drop_table("offers")
    op.drop_index(op.f("ix_info_requests_application_id"), table_name="info_requests")
    op.drop_table("info_requests")
    op.drop_index(op.f("ix_credit_decisions_application_id"), table_name="credit_decisions")
    op.drop_table("credit_decisions")
    op.drop_index(op.f("ix_risk_assessments_revision_id"), table_name="risk_assessments")
    op.drop_index(op.f("ix_risk_assessments_application_id"), table_name="risk_assessments")
    op.drop_table("risk_assessments")
    op.drop_index(op.f("ix_check_results_revision_id"), table_name="check_results")
    op.drop_index(op.f("ix_check_results_application_id"), table_name="check_results")
    op.drop_table("check_results")
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index(op.f("ix_assistant_messages_session_id"), table_name="assistant_messages")
    op.drop_table("assistant_messages")
    op.drop_index(op.f("ix_application_revisions_application_id"), table_name="application_revisions")
    op.drop_table("application_revisions")
    op.drop_index(op.f("ix_application_notes_application_id"), table_name="application_notes")
    op.drop_table("application_notes")
    op.drop_index("ix_application_events_timeline", table_name="application_events")
    op.drop_table("application_events")
    op.drop_index(op.f("ix_application_documents_application_id"), table_name="application_documents")
    op.drop_table("application_documents")
    op.drop_index(op.f("ix_idempotency_keys_created_at"), table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
    op.drop_table("credit_policies")
    op.drop_index("ix_audit_log_entity", table_name="audit_log")
    op.drop_index("ix_audit_log_created", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index(op.f("ix_assistant_sessions_user_id"), table_name="assistant_sessions")
    op.drop_table("assistant_sessions")
    op.drop_index(op.f("ix_applications_status"), table_name="applications")
    op.drop_index(op.f("ix_applications_product_code"), table_name="applications")
    op.drop_index(
        "ix_applications_next_run_at", table_name="applications", postgresql_where=sa.text("next_run_at IS NOT NULL")
    )
    op.drop_index("ix_applications_company_updated", table_name="applications")
    op.drop_index(op.f("ix_applications_company_id"), table_name="applications")
    op.drop_index(op.f("ix_applications_assignee_id"), table_name="applications")
    op.drop_table("applications")
    op.drop_index(op.f("ix_users_company_id"), table_name="users")
    op.drop_table("users")
    op.drop_index(op.f("ix_external_loans_company_id"), table_name="external_loans")
    op.drop_table("external_loans")
    op.drop_table("company_sources")
    op.drop_table("account_turnover")
    op.drop_table("system_state")
    op.drop_table("products")
    op.drop_table("companies")
    op.execute(sa.schema.DropSequence(sa.Sequence("disbursement_operation_seq")))
    op.execute(sa.schema.DropSequence(sa.Sequence("application_number_seq")))

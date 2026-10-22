export type Role = 'CLIENT' | 'UNDERWRITER' | 'ADMIN'
export type BankRole = Exclude<Role, 'CLIENT'>

export interface User {
  id: string
  email: string
  full_name: string
  role: Role
  position: string
  company_id: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  access_token: string
  user: User
}

export type PurposeType = 'WORKING_CAPITAL' | 'CASH_GAP' | 'EQUIPMENT' | 'INVESTMENT' | 'REAL_ESTATE' | 'GOV_CONTRACT' | 'REFINANCING'
export type ProductCategory = 'WORKING' | 'INVESTMENT' | 'SPECIAL'
export type Collateral = 'NONE' | 'GUARANTEE' | 'EQUIPMENT' | 'PROPERTY' | 'CONTRACT'
export type Repayment = 'ANNUITY' | 'REVOLVING'

export interface Product {
  code: string
  name: string
  description: string
  min_amount: number
  max_amount: number
  min_term: number
  max_term: number
  base_rate: number
  purpose_types: PurposeType[]
  requires_invoice: boolean
  category: ProductCategory
  collateral: Collateral
  repayment: Repayment
  down_payment_share: number
  targeted: boolean
  okved_prefixes: string[]
  active: boolean
}

export interface DemoAccount {
  email: string
  title: string
  description: string
}

export interface AppConfig {
  assistant_enabled: boolean
  manual_review_amount_threshold: number
  products: Product[]
  demo_password: string | null
  demo_accounts: DemoAccount[]
}

export interface Payment {
  date: string
  amount: number
  principal: number
  interest: number
  balance: number
}

export type TaxSystem = 'USN_6' | 'USN_15' | 'OSN' | 'PATENT'
export type LegalForm = 'OOO' | 'IP'

export interface Company {
  id: string
  inn: string
  ogrn: string
  name: string
  legal_form: LegalForm
  registration_date: string
  okved_main: string
  okved_name: string
  address: string
  head_name: string
  tax_system: TaxSystem
  employees_count: number
}

export type CompanyLookup = Omit<Company, 'id'>

export interface TurnoverMonth {
  month: string
  inflow: number
  outflow: number
}

export interface ActiveLoan {
  id: string
  contract_number: string
  product_name: string
  amount: number
  balance: number
  rate: number
  monthly_payment: number
  next_payment_date: string
  issued_at: string
  maturity_date: string
}

export interface CompanyInsights {
  turnover: TurnoverMonth[]
  avg_free_cash_flow: number
  pre_approved_limit: number
  loans: ActiveLoan[]
}

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'VALIDATING'
  | 'ENRICHING'
  | 'SCORING'
  | 'DECIDING'
  | 'APPROVED'
  | 'COUNTER_OFFER'
  | 'NEED_INFO'
  | 'MANUAL_REVIEW'
  | 'REJECTED'
  | 'SIGNING'
  | 'SIGNED'
  | 'DISBURSED'
  | 'CLIENT_DECLINED'
  | 'CANCELLED'

export interface ApplicationShort {
  id: string
  number: string
  product_code: string
  product_name: string
  amount: number
  term: number
  status: ApplicationStatus
  created_at: string
  updated_at: string
}

export interface Financials {
  revenue_12m: number
  revenue_last_3m: number[]
  expenses_12m: number
  net_profit_12m: number
  monthly_debt_payments: number
  employees_count: number
  tax_system: TaxSystem
}

export type DocumentKind = 'BANK_STATEMENT' | 'TAX_RETURN' | 'EQUIPMENT_INVOICE' | 'OTHER'

export interface AppDocument {
  id: string
  kind: DocumentKind
  filename: string
  size: number
  created_at: string
}

export interface Consents {
  bki: boolean
  personal_data: boolean
  risks: boolean
}

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'

export interface Offer {
  id: string
  amount: number
  term: number
  rate: number
  monthly_payment: number
  is_counter: boolean
  status: OfferStatus
  valid_until: string
  requested: { amount: number; term: number; rate: number; monthly_payment: number }
}

export type InfoItemType = 'text' | 'number' | 'document'

export interface InfoRequestItem {
  code: string
  label: string
  type: InfoItemType
}

export interface InfoRequest {
  id: string
  items: InfoRequestItem[]
  comment: string
  status: 'OPEN' | 'ANSWERED'
}

export type DecisionType = 'APPROVED' | 'COUNTER_OFFER' | 'NEED_INFO' | 'MANUAL_REVIEW' | 'REJECTED'

export interface Decision {
  type: DecisionType
  made_by: string
  reasons: string[]
  created_at: string
}

export interface Application {
  id: string
  number: string
  status: ApplicationStatus
  product: Product
  amount: number
  term: number
  purpose: string
  purpose_type: PurposeType | null
  company: Company
  company_confirmed: boolean
  financials: Financials | null
  documents: AppDocument[]
  consents: Consents
  offer: Offer | null
  info_request: InfoRequest | null
  decision: Decision | null
  contract: { number: string; signed_at: string | null } | null
  created_at: string
  submitted_at: string | null
  updated_at: string
}

export interface CreateApplicationRequest {
  product_code: string
  amount: number
  term: number
  purpose: string
  purpose_type?: PurposeType | null
}

export interface PatchApplicationRequest {
  amount?: number
  term?: number
  purpose?: string
  purpose_type?: PurposeType | null
  product_code?: string
  company_confirmed?: boolean
  financials?: Financials
  consents?: Consents
}

export type ActorType = 'CLIENT' | 'SYSTEM' | 'UNDERWRITER'

export interface AppEvent {
  id: string
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  actor_type: ActorType
  actor_name: string
  reason: string | null
  created_at: string
}

export interface InfoAnswer {
  code: string
  value: string
}

export interface Contract {
  number: string
  html: string
}

export interface SignResponse {
  confirmation_code: string
}

export type NotificationType =
  | 'APPLICATION_SUBMITTED'
  | 'STAGE_PASSED'
  | 'INFO_REQUESTED'
  | 'DECISION_MADE'
  | 'OFFER_PENDING'
  | 'OFFER_EXPIRING'
  | 'CONTRACT_READY'
  | 'DISBURSED'
  | 'PERSONAL_OFFER'

export interface AppNotification {
  id: string
  application_id: string | null
  type: NotificationType
  title: string
  body: string
  is_read: boolean
  created_at: string
}

export type AssistantFieldValue = string | number | boolean | null

export interface AssistantContext {
  screen: string
  title: string
  path: string
  application_id: string | null
  data: Record<string, AssistantFieldValue>
}

export interface AssistantHint {
  target: string
  label: string
}

export interface AssistantAction {
  type: 'set_loan_params'
  amount: number | null
  term: number | null
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  hints: AssistantHint[]
  suggestions: string[]
  actions: AssistantAction[]
  created_at: string
}

export interface AssistantChatRequest {
  session_id: string | null
  message: string
  context: AssistantContext
}

export interface AssistantChatResponse {
  session_id: string
  message: AssistantMessage
}

export interface AssistantSession {
  session_id: string
  messages: AssistantMessage[]
}

export type Grade = 'A' | 'B' | 'C' | 'D'

export interface BankApplicationShort {
  id: string
  number: string
  company_name: string
  inn: string
  product_code: string
  product_name: string
  amount: number
  term: number
  status: ApplicationStatus
  grade: Grade | null
  score: number | null
  waiting_since: string
  assigned_to: string | null
}

export interface EgrulData {
  status: string
  ogrn: string
  registration_date: string
  okved_main: string
  okved_name: string
  head_name: string
  address: string
}

export interface FnsData {
  tax_debt: number
  account_blocks: boolean
  mass_address: boolean
  disqualified_head: boolean
  declared_revenue_12m: number
}

export interface BkiLoan {
  creditor: string
  amount: number
  balance: number
  opened_at: string
  closed_at: string | null
  max_overdue_days: number
}

export interface BkiData {
  rating: number
  rating_label: string
  active_loans: BkiLoan[]
  closed_loans: BkiLoan[]
  max_overdue_days_24m: number
}

export interface ScoringFactor {
  code: string
  name: string
  value: string
  points: number
  max_points: number
  comment: string
}

export interface Scoring {
  score: number
  grade: Grade
  factors: ScoringFactor[]
  stop_factors: string[]
  model_version: string
}

export interface Recommendation {
  type: DecisionType
  amount?: number
  term?: number
  rate?: number
  reasons: string[]
}

export interface Discrepancy {
  field: string
  label: string
  declared: number
  external: number
  diff_percent: number
}

export interface BankApplication extends Application {
  enrichment: { egrul: EgrulData; fns: FnsData; bki: BkiData } | null
  scoring: Scoring | null
  recommendation: Recommendation | null
  discrepancies: Discrepancy[]
  assigned_to: string | null
  assignee_id: string | null
}

export type BankDecisionType = 'APPROVED' | 'COUNTER_OFFER' | 'NEED_INFO' | 'REJECTED'

export interface BankDecisionRequest {
  type: BankDecisionType
  amount?: number
  term?: number
  rate?: number
  items?: string[]
  reason_code?: string
  comment: string
}

export interface BankStats {
  total: number
  auto_decision_share: number
  avg_amount: number
  avg_review_hours: number
  funnel: { status: ApplicationStatus; count: number }[]
}

export interface ApiErrorBody {
  detail: string
  code: string
  missing?: string[]
}

export interface ApplicationNote {
  id: string
  author_id: string
  author_name: string
  text: string
  created_at: string
}

export type AutoDecision = 'APPROVED' | 'COUNTER_OFFER' | 'MANUAL_REVIEW' | 'REJECTED'

export interface GradePolicy {
  min_score: number
  auto_decision: AutoDecision
  rate_markup: number
}

export interface CreditPolicyInput {
  manual_review_amount_threshold: number
  product_review_thresholds: Record<string, number>
  grades: Record<Grade, GradePolicy>
  stop_factors_decision: 'REJECTED' | 'MANUAL_REVIEW'
  counter_offer_share: number
  offer_valid_days: number
  manual_review_sla_hours: number
  auto_assign: boolean
  auto_disbursement: boolean
}

export interface CreditPolicy extends CreditPolicyInput {
  updated_at: string | null
  updated_by: string | null
}

export interface AuditEntry {
  id: string
  created_at: string
  actor_id: string | null
  actor_name: string
  actor_role: 'UNDERWRITER' | 'ADMIN' | 'SYSTEM'
  action: string
  entity_type: 'application' | 'product' | 'policy' | 'staff'
  entity_id: string
  summary: string
}

export interface StaffMember {
  id: string
  email: string
  full_name: string
  role: BankRole
  position: string
  active: boolean
  active_reviews: number
  decisions_total: number
}

export interface StaffCreateRequest {
  email: string
  full_name: string
  position?: string
  role?: BankRole
  password: string
}

export interface StaffPatchRequest {
  full_name?: string
  position?: string
  role?: BankRole
  active?: boolean
  password?: string
}

export type ProductCreateRequest = Omit<
  Product,
  | 'active'
  | 'description'
  | 'requires_invoice'
  | 'category'
  | 'collateral'
  | 'repayment'
  | 'down_payment_share'
  | 'targeted'
  | 'okved_prefixes'
> & {
  description?: string
  requires_invoice?: boolean
  category?: ProductCategory
  collateral?: Collateral
  repayment?: Repayment
  down_payment_share?: number
  targeted?: boolean
  okved_prefixes?: string[]
  active?: boolean
}

export type ProductPatchRequest = Partial<Omit<Product, 'code'>>

export interface ProductAdmin extends Product {
  applications_total: number
  applications_in_progress: number
  disbursed_amount: number
}

export interface AdminApplicationRow extends BankApplicationShort {
  assignee_id: string | null
  submitted_at: string | null
  waiting_hours: number
  sla_breached: boolean
}

export interface AdminDashboard {
  period_days: number | null
  totals: {
    applications: number
    drafts: number
    in_progress: number
    manual_review: number
    awaiting_client: number
    approved: number
    rejected: number
    closed_by_client: number
    disbursed_count: number
    disbursed_amount: number
  }
  approval_rate: number
  auto_decision_share: number
  avg_time_to_decision_minutes: number
  avg_manual_review_hours: number
  funnel: { status: ApplicationStatus; count: number }[]
  by_product: ProductStats[]
  underwriters: UnderwriterStats[]
  sla_hours: number
  sla_breaches: SlaBreach[]
}

export interface ProductStats {
  code: string
  name: string
  active: boolean
  applications: number
  approved: number
  disbursed_amount: number
  avg_amount: number
}

export interface UnderwriterStats {
  id: string
  full_name: string
  role: BankRole
  active: boolean
  active_reviews: number
  decisions: number
  avg_review_hours: number
}

export interface SlaBreach {
  id: string
  number: string
  company_name: string
  amount: number
  waiting_hours: number
  assigned_to: string | null
}

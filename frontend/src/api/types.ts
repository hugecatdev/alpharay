export type Role = 'CLIENT' | 'UNDERWRITER'

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

export type PurposeType = 'WORKING_CAPITAL' | 'CASH_GAP' | 'EQUIPMENT'

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
}

export interface AppConfig {
  assistant_enabled: boolean
  manual_review_amount_threshold: number
  products: Product[]
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

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  hints: AssistantHint[]
  suggestions: string[]
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

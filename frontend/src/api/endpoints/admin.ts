import { request } from '../client'
import type {
  AdminApplicationRow,
  AdminDashboard,
  ApplicationStatus,
  AuditEntry,
  BankApplication,
  CreditPolicy,
  CreditPolicyInput,
  ProductAdmin,
  ProductCreateRequest,
  ProductPatchRequest,
  StaffCreateRequest,
  StaffMember,
  StaffPatchRequest,
} from '../types'

export interface AdminApplicationsQuery {
  status?: ApplicationStatus
  product_code?: string
  assignee_id?: string
  sla_breached?: boolean
  q?: string
}

export interface AuditQuery {
  entity_type?: AuditEntry['entity_type']
  entity_id?: string
  actor_id?: string
  action?: string
  limit?: number
}

export const adminApi = {
  dashboard: (days?: number) => request<AdminDashboard>('/admin/dashboard', { query: { days } }),
  applications: (query: AdminApplicationsQuery = {}) =>
    request<AdminApplicationRow[]>('/admin/applications', { query: { ...query } }),
  assign: (id: string, assigneeId: string | null) =>
    request<BankApplication>(`/admin/applications/${id}/assign`, { method: 'POST', body: { assignee_id: assigneeId } }),
  staff: () => request<StaffMember[]>('/admin/staff'),
  createStaff: (body: StaffCreateRequest) => request<StaffMember>('/admin/staff', { method: 'POST', body }),
  updateStaff: (id: string, body: StaffPatchRequest) =>
    request<StaffMember>(`/admin/staff/${id}`, { method: 'PATCH', body }),
  products: () => request<ProductAdmin[]>('/admin/products'),
  createProduct: (body: ProductCreateRequest) => request<ProductAdmin>('/admin/products', { method: 'POST', body }),
  updateProduct: (code: string, body: ProductPatchRequest) =>
    request<ProductAdmin>(`/admin/products/${code}`, { method: 'PATCH', body }),
  policy: () => request<CreditPolicy>('/admin/policy'),
  updatePolicy: (body: CreditPolicyInput) => request<CreditPolicy>('/admin/policy', { method: 'PUT', body }),
  audit: (query: AuditQuery = {}) => request<AuditEntry[]>('/admin/audit', { query: { ...query } }),
}

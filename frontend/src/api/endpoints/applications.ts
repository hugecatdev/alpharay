import { request } from '../client'
import type {
  AppDocument,
  AppEvent,
  Application,
  ApplicationShort,
  Contract,
  CreateApplicationRequest,
  DocumentKind,
  InfoAnswer,
  PatchApplicationRequest,
  Payment,
  SigningCertificate,
  SignResponse,
} from '../types'

export const applicationsApi = {
  list: () => request<ApplicationShort[]>('/applications'),
  get: (id: string) => request<Application>(`/applications/${id}`),
  create: (body: CreateApplicationRequest) =>
    request<Application>('/applications', { method: 'POST', body, idempotent: true }),
  patch: (id: string, body: PatchApplicationRequest, version?: number) =>
    request<Application>(`/applications/${id}`, {
      method: 'PATCH',
      body,
      headers: version === undefined ? undefined : { 'If-Match': `"${version}"` },
    }),
  uploadDocument: (id: string, kind: DocumentKind, file: File) => {
    const form = new FormData()
    form.append('kind', kind)
    form.append('file', file)
    return request<AppDocument>(`/applications/${id}/documents`, { method: 'POST', form })
  },
  deleteDocument: (id: string, docId: string) =>
    request<void>(`/applications/${id}/documents/${docId}`, { method: 'DELETE' }),
  submit: (id: string, options: { mockFail?: number } = {}) =>
    request<Application>(`/applications/${id}/submit`, {
      method: 'POST',
      query: { mock_fail: options.mockFail || undefined },
      idempotent: true,
    }),
  cancel: (id: string) => request<Application>(`/applications/${id}/cancel`, { method: 'POST', idempotent: true }),
  resubmit: (id: string) =>
    request<Application>(`/applications/${id}/resubmit`, { method: 'POST', idempotent: true }),
  events: (id: string) => request<AppEvent[]>(`/applications/${id}/events`),
  respondInfo: (id: string, requestId: string, answers: InfoAnswer[]) =>
    request<Application>(`/applications/${id}/info-requests/${requestId}/respond`, {
      method: 'POST',
      body: { answers },
      idempotent: true,
    }),
  acceptOffer: (id: string, offerId?: string) =>
    request<Application>(`/applications/${id}/offer/accept`, {
      method: 'POST',
      body: offerId ? { offer_id: offerId } : undefined,
      idempotent: true,
    }),
  declineOffer: (id: string) =>
    request<Application>(`/applications/${id}/offer/decline`, { method: 'POST', idempotent: true }),
  contract: (id: string) => request<Contract>(`/applications/${id}/contract`),
  sign: (id: string) => request<SignResponse>(`/applications/${id}/sign`, { method: 'POST', idempotent: true }),
  confirmSign: (id: string, code: string) =>
    request<Application>(`/applications/${id}/sign/confirm`, { method: 'POST', body: { code }, idempotent: true }),
  certificates: (id: string) => request<SigningCertificate[]>(`/applications/${id}/sign/certificates`),
  signKep: (id: string, certificateId: string) =>
    request<Application>(`/applications/${id}/sign/kep`, {
      method: 'POST',
      body: { certificate_id: certificateId },
      idempotent: true,
    }),
  schedule: (id: string) => request<Payment[]>(`/applications/${id}/schedule`),
}

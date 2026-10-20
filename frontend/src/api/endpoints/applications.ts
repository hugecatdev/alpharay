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
  SignResponse,
} from '../types'

export const applicationsApi = {
  list: () => request<ApplicationShort[]>('/applications'),
  get: (id: string) => request<Application>(`/applications/${id}`),
  create: (body: CreateApplicationRequest) => request<Application>('/applications', { method: 'POST', body }),
  patch: (id: string, body: PatchApplicationRequest) =>
    request<Application>(`/applications/${id}`, { method: 'PATCH', body }),
  uploadDocument: (id: string, kind: DocumentKind, file: File) => {
    const form = new FormData()
    form.append('kind', kind)
    form.append('file', file)
    return request<AppDocument>(`/applications/${id}/documents`, { method: 'POST', form })
  },
  deleteDocument: (id: string, docId: string) =>
    request<void>(`/applications/${id}/documents/${docId}`, { method: 'DELETE' }),
  submit: (id: string, options: { mockFail?: boolean } = {}) =>
    request<Application>(`/applications/${id}/submit`, {
      method: 'POST',
      query: { mock_fail: options.mockFail ? 1 : undefined },
    }),
  cancel: (id: string) => request<Application>(`/applications/${id}/cancel`, { method: 'POST' }),
  events: (id: string) => request<AppEvent[]>(`/applications/${id}/events`),
  respondInfo: (id: string, requestId: string, answers: InfoAnswer[]) =>
    request<Application>(`/applications/${id}/info-requests/${requestId}/respond`, {
      method: 'POST',
      body: { answers },
    }),
  acceptOffer: (id: string) => request<Application>(`/applications/${id}/offer/accept`, { method: 'POST' }),
  declineOffer: (id: string) => request<Application>(`/applications/${id}/offer/decline`, { method: 'POST' }),
  contract: (id: string) => request<Contract>(`/applications/${id}/contract`),
  sign: (id: string) => request<SignResponse>(`/applications/${id}/sign`, { method: 'POST' }),
  confirmSign: (id: string, code: string) =>
    request<Application>(`/applications/${id}/sign/confirm`, { method: 'POST', body: { code } }),
  schedule: (id: string) => request<Payment[]>(`/applications/${id}/schedule`),
}

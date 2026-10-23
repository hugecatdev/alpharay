import { request } from '../client'
import type {
  AppEvent,
  ApplicationNote,
  ApplicationStatus,
  BankApplication,
  BankApplicationShort,
  BankDecisionRequest,
  BankStats,
} from '../types'

export const bankApi = {
  list: (params: { status?: ApplicationStatus | 'ALL'; assigned?: 'me' | 'any' | 'none' } = {}) =>
    request<BankApplicationShort[]>('/bank/applications', {
      query: { status: params.status === 'ALL' ? undefined : params.status, assigned: params.assigned },
    }),
  get: (id: string) => request<BankApplication>(`/bank/applications/${id}`),
  events: (id: string) => request<AppEvent[]>(`/bank/applications/${id}/events`),
  assign: (id: string) => request<BankApplication>(`/bank/applications/${id}/assign`, { method: 'POST' }),
  decide: (id: string, body: BankDecisionRequest) =>
    request<BankApplication>(`/bank/applications/${id}/decision`, { method: 'POST', body, idempotent: true }),
  stats: () => request<BankStats>('/bank/stats'),
  notes: (id: string) => request<ApplicationNote[]>(`/bank/applications/${id}/notes`),
  addNote: (id: string, text: string) =>
    request<ApplicationNote>(`/bank/applications/${id}/notes`, { method: 'POST', body: { text } }),
  disburse: (id: string) =>
    request<BankApplication>(`/bank/applications/${id}/disburse`, { method: 'POST', idempotent: true }),
}

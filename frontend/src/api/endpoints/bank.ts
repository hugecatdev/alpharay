import { request } from '../client'
import type { AppEvent, ApplicationStatus, BankApplication, BankApplicationShort, BankDecisionRequest, BankStats } from '../types'

export const bankApi = {
  list: (params: { status?: ApplicationStatus | 'ALL'; assigned?: 'me' | 'any' } = {}) =>
    request<BankApplicationShort[]>('/bank/applications', {
      query: { status: params.status === 'ALL' ? undefined : params.status, assigned: params.assigned },
    }),
  get: (id: string) => request<BankApplication>(`/bank/applications/${id}`),
  events: (id: string) => request<AppEvent[]>(`/bank/applications/${id}/events`),
  assign: (id: string) => request<BankApplication>(`/bank/applications/${id}/assign`, { method: 'POST' }),
  decide: (id: string, body: BankDecisionRequest) =>
    request<BankApplication>(`/bank/applications/${id}/decision`, { method: 'POST', body }),
  stats: () => request<BankStats>('/bank/stats'),
}

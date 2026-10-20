import { request } from '../client'
import type { AppConfig, Company, CompanyInsights, CompanyLookup } from '../types'

export const configApi = {
  get: () => request<AppConfig>('/config'),
}

export const companyApi = {
  get: () => request<Company>('/company'),
  link: (inn: string) => request<Company>('/company', { method: 'POST', body: { inn } }),
  lookup: (inn: string) => request<CompanyLookup>('/company/lookup', { query: { inn } }),
  insights: () => request<CompanyInsights>('/company/insights'),
}

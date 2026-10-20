import { http } from 'msw'
import type { CompanyLookup } from '@/api/types'
import { findCompany } from '../db'
import { companyInsights } from '../insights'
import { apiError, json } from '../utils'
import { route } from './common'

export const companyHandlers = [
  http.get(
    '/api/company',
    route(
      ({ db, user }) => {
        if (!user.company_id) return apiError(404, 'NO_COMPANY', 'Компания ещё не добавлена')
        const mc = findCompany(db, user.company_id)
        if (!mc) return apiError(404, 'NOT_FOUND', 'Компания не найдена')
        return json(mc.company)
      },
      { role: 'CLIENT' },
    ),
  ),
  http.post(
    '/api/company',
    route(
      async ({ db, user, request }) => {
        if (user.company_id) return apiError(409, 'COMPANY_EXISTS', 'Компания уже добавлена')
        const body: unknown = await request.json().catch(() => null)
        const raw = typeof body === 'object' && body !== null && 'inn' in body ? String((body as { inn: unknown }).inn) : ''
        const inn = raw.replace(/\s/g, '')
        if (!/^(\d{10}|\d{12})$/.test(inn)) return apiError(422, 'INVALID_INN', 'ИНН должен содержать 10 цифр для юрлица или 12 цифр для ИП')
        const mc = db.companies.find((item) => item.company.inn === inn)
        if (!mc) return apiError(404, 'NOT_FOUND', 'Компания с таким ИНН не найдена в ЕГРЮЛ/ЕГРИП')
        if (db.users.some((item) => item.company_id === mc.company.id)) {
          return apiError(409, 'ALREADY_LINKED', 'Эта компания уже подключена к другому пользователю')
        }
        user.company_id = mc.company.id
        return json(mc.company)
      },
      { role: 'CLIENT', delay: [400, 800] },
    ),
  ),
  http.get(
    '/api/company/lookup',
    route(
      ({ db, url }) => {
        const inn = (url.searchParams.get('inn') ?? '').replace(/\s/g, '')
        if (!/^(\d{10}|\d{12})$/.test(inn)) return apiError(422, 'INVALID_INN', 'ИНН должен содержать 10 цифр для юрлица или 12 цифр для ИП')
        const mc = db.companies.find((item) => item.company.inn === inn)
        if (!mc) return apiError(404, 'NOT_FOUND', 'Компания с таким ИНН не найдена в ЕГРЮЛ/ЕГРИП')
        const { id: _id, ...rest } = mc.company
        void _id
        const lookup: CompanyLookup = rest
        return json(lookup)
      },
      { role: 'CLIENT', delay: [400, 800] },
    ),
  ),
  http.get(
    '/api/company/insights',
    route(
      ({ db, user, now }) => {
        if (!user.company_id) return apiError(404, 'NO_COMPANY', 'Компания ещё не добавлена')
        const mc = findCompany(db, user.company_id)
        if (!mc) return apiError(404, 'NOT_FOUND', 'Компания не найдена')
        return json(companyInsights(db, mc, now))
      },
      { role: 'CLIENT' },
    ),
  ),
]

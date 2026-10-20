import { http } from 'msw'
import type { ApplicationStatus, BankDecisionRequest, BankDecisionType, BankStats, InfoRequestItem } from '@/api/types'
import { infoRequestOptions, rejectReasonOptions } from '@/shared/lib/labels'
import { findApplication, type MockApplication } from '../db'
import { applyDecision, SYSTEM_ACTOR } from '../pipeline'
import { eventsOf, toBankApplication, toBankShort } from '../queries'
import { apiError, HOUR, iso, json } from '../utils'
import { readJson, route, type HandlerContext } from './common'

const STATUSES: ApplicationStatus[] = [
  'SUBMITTED',
  'VALIDATING',
  'ENRICHING',
  'SCORING',
  'DECIDING',
  'MANUAL_REVIEW',
  'NEED_INFO',
  'COUNTER_OFFER',
  'APPROVED',
  'SIGNING',
  'SIGNED',
  'DISBURSED',
  'REJECTED',
  'CLIENT_DECLINED',
  'CANCELLED',
]
const DECISIONS: BankDecisionType[] = ['APPROVED', 'COUNTER_OFFER', 'NEED_INFO', 'REJECTED']

function isStatus(value: string | null): value is ApplicationStatus {
  return value !== null && (STATUSES as string[]).includes(value)
}

function bankRecord(ctx: HandlerContext): MockApplication | null {
  const record = findApplication(ctx.db, ctx.params.id)
  if (!record || record.app.status === 'DRAFT') return null
  return record
}

function mineMatches(assigned: string | null, ctx: HandlerContext): boolean {
  return assigned !== null && [ctx.user.full_name, ctx.user.id, ctx.user.email].includes(assigned)
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export const bankHandlers = [
  http.get(
    '/api/bank/stats',
    route(
      ({ db }) => {
        const submitted = db.applications.filter((record) => record.app.status !== 'DRAFT')
        const decided = submitted.filter((record) => record.app.decision && record.app.decision.type !== 'MANUAL_REVIEW')
        const auto = decided.filter((record) => record.app.decision?.made_by === SYSTEM_ACTOR).length
        const reviewHours: number[] = []
        for (const record of submitted) {
          const events = eventsOf(db, record.app.id)
          const entered = events.find((event) => event.to_status === 'MANUAL_REVIEW')
          if (!entered) continue
          const resolved = events.find(
            (event) => event.from_status === 'MANUAL_REVIEW' && event.actor_type === 'UNDERWRITER' && event.created_at >= entered.created_at,
          )
          if (!resolved) continue
          reviewHours.push((new Date(resolved.created_at).getTime() - new Date(entered.created_at).getTime()) / HOUR)
        }
        const stats: BankStats = {
          total: submitted.length,
          auto_decision_share: decided.length ? Math.round((auto / decided.length) * 100) / 100 : 0,
          avg_amount: submitted.length ? Math.round(submitted.reduce((sum, record) => sum + record.app.amount, 0) / submitted.length) : 0,
          avg_review_hours: reviewHours.length ? Math.round((reviewHours.reduce((sum, value) => sum + value, 0) / reviewHours.length) * 10) / 10 : 0,
          funnel: STATUSES.map((status) => ({ status, count: submitted.filter((record) => record.app.status === status).length })),
        }
        return json(stats)
      },
      { role: 'UNDERWRITER' },
    ),
  ),

  http.get(
    '/api/bank/applications',
    route(
      (ctx) => {
        const status = ctx.url.searchParams.get('status')
        const assigned = ctx.url.searchParams.get('assigned')
        const list = ctx.db.applications
          .filter((record) => record.app.status !== 'DRAFT')
          .filter((record) => !isStatus(status) || record.app.status === status)
          .filter((record) => assigned !== 'me' || mineMatches(record.assigned_to, ctx))
          .sort((a, b) => a.stage_entered_at - b.stage_entered_at)
          .map(toBankShort)
        return json(list)
      },
      { role: 'UNDERWRITER' },
    ),
  ),

  http.get(
    '/api/bank/applications/:id',
    route(
      (ctx) => {
        const record = bankRecord(ctx)
        return record ? json(toBankApplication(ctx.db, record)) : apiError(404, 'NOT_FOUND', 'Заявка не найдена')
      },
      { role: 'UNDERWRITER' },
    ),
  ),

  http.get(
    '/api/bank/applications/:id/events',
    route(
      (ctx) => {
        const record = bankRecord(ctx)
        return record ? json(eventsOf(ctx.db, record.app.id)) : apiError(404, 'NOT_FOUND', 'Заявка не найдена')
      },
      { role: 'UNDERWRITER' },
    ),
  ),

  http.post(
    '/api/bank/applications/:id/assign',
    route(
      (ctx) => {
        const record = bankRecord(ctx)
        if (!record) return apiError(404, 'NOT_FOUND', 'Заявка не найдена')
        record.assigned_to = ctx.user.full_name
        record.app.updated_at = iso(ctx.now)
        return json(toBankApplication(ctx.db, record))
      },
      { role: 'UNDERWRITER' },
    ),
  ),

  http.post(
    '/api/bank/applications/:id/decision',
    route(
      async (ctx) => {
        const record = bankRecord(ctx)
        if (!record) return apiError(404, 'NOT_FOUND', 'Заявка не найдена')
        if (record.app.status !== 'MANUAL_REVIEW') {
          return apiError(409, 'INVALID_STATUS', 'Решение можно принять только по заявке на ручном рассмотрении')
        }
        const body = await readJson<BankDecisionRequest>(ctx.request)
        const type = DECISIONS.find((item) => item === body.type)
        if (!type) return apiError(422, 'VALIDATION', 'Выберите тип решения')
        const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
        const amount = positiveNumber(body.amount)
        const term = positiveNumber(body.term)
        const rate = positiveNumber(body.rate)
        const product = record.app.product

        if (type === 'COUNTER_OFFER') {
          if (!amount || !term || !rate) return apiError(422, 'VALIDATION', 'Укажите сумму, срок и ставку предложения')
        }
        if ((type === 'APPROVED' || type === 'COUNTER_OFFER') && amount !== undefined) {
          if (amount < product.min_amount || amount > product.max_amount) {
            return apiError(422, 'VALIDATION', `Сумма должна быть в пределах продукта: ${product.min_amount}–${product.max_amount} ₽`)
          }
        }
        if ((type === 'APPROVED' || type === 'COUNTER_OFFER') && term !== undefined) {
          if (term < product.min_term || term > product.max_term) {
            return apiError(422, 'VALIDATION', `Срок должен быть в пределах продукта: ${product.min_term}–${product.max_term} мес.`)
          }
        }

        let items: InfoRequestItem[] | undefined
        if (type === 'NEED_INFO') {
          const codes = Array.isArray(body.items) ? body.items.filter((item): item is string => typeof item === 'string') : []
          if (!codes.length) return apiError(422, 'VALIDATION', 'Отметьте, какую информацию запросить')
          items = codes.map((code) => {
            const option = infoRequestOptions.find((entry) => entry.code === code)
            return option ? { code: option.code, label: option.label, type: option.type } : { code, label: code, type: 'text' }
          })
        }

        const reasons: string[] = []
        if (type === 'REJECTED') {
          const reason = rejectReasonOptions.find((entry) => entry.code === body.reason_code)
          if (!reason) return apiError(422, 'VALIDATION', 'Выберите причину отказа')
          reasons.push(reason.label)
        }
        if (comment) reasons.push(comment)
        if (!reasons.length) {
          reasons.push(
            type === 'APPROVED'
              ? 'Одобрено кредитным специалистом'
              : type === 'COUNTER_OFFER'
                ? 'Условия скорректированы кредитным специалистом'
                : 'Нужны дополнительные сведения',
          )
        }

        applyDecision(
          ctx.db,
          record,
          { type, amount: type === 'APPROVED' || type === 'COUNTER_OFFER' ? amount : undefined, term, rate, reasons, items, comment },
          'UNDERWRITER',
          ctx.user.full_name,
          ctx.now,
        )
        if (!record.assigned_to) record.assigned_to = ctx.user.full_name
        return json(toBankApplication(ctx.db, record))
      },
      { role: 'UNDERWRITER' },
    ),
  ),
]

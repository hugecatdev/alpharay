import { http } from 'msw'
import type {
  AppDocument,
  ApplicationStatus,
  Consents,
  Contract,
  CreateApplicationRequest,
  DocumentKind,
  Financials,
  InfoAnswer,
  PatchApplicationRequest,
  PurposeType,
  TaxSystem,
} from '@/api/types'
import { buildSchedule } from '@/shared/lib/annuity'
import { findCompany, findProduct, nextNumber, type MockApplication } from '../db'
import { contractHtml } from '../contract'
import { addEvent, MISSING_LABELS, notify, setStatus, submitApplication, submitMissing } from '../pipeline'
import { eventsOf, findApplicationsOfCompany, toShort } from '../queries'
import { apiError, clamp, iso, json, noContent, uid } from '../utils'
import { notFound, ownApplication, readJson, route } from './common'

const DOCUMENT_KINDS: DocumentKind[] = ['BANK_STATEMENT', 'TAX_RETURN', 'EQUIPMENT_INVOICE', 'OTHER']
const PURPOSES: PurposeType[] = ['WORKING_CAPITAL', 'CASH_GAP', 'EQUIPMENT']
const TAX_SYSTEMS: TaxSystem[] = ['USN_6', 'USN_15', 'OSN', 'PATENT']
const CANCELLABLE: ApplicationStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'VALIDATING',
  'ENRICHING',
  'SCORING',
  'DECIDING',
  'MANUAL_REVIEW',
  'NEED_INFO',
  'COUNTER_OFFER',
  'APPROVED',
]
const MAX_FILE_SIZE = 20 * 1024 * 1024

function isPurpose(value: unknown): value is PurposeType {
  return typeof value === 'string' && (PURPOSES as string[]).includes(value)
}

function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === 'string' && (DOCUMENT_KINDS as string[]).includes(value)
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function parseFinancials(value: unknown): Financials | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Partial<Record<keyof Financials, unknown>>
  const last = Array.isArray(source.revenue_last_3m) ? source.revenue_last_3m.map((item) => Math.max(0, toNumber(item))) : []
  const tax = TAX_SYSTEMS.find((item) => item === source.tax_system) ?? 'USN_6'
  return {
    revenue_12m: Math.max(0, toNumber(source.revenue_12m)),
    revenue_last_3m: [last[0] ?? 0, last[1] ?? 0, last[2] ?? 0],
    expenses_12m: Math.max(0, toNumber(source.expenses_12m)),
    net_profit_12m: toNumber(source.net_profit_12m),
    monthly_debt_payments: Math.max(0, toNumber(source.monthly_debt_payments)),
    employees_count: Math.max(0, toNumber(source.employees_count)),
    tax_system: tax,
  }
}

function parseConsents(value: unknown, current: Consents): Consents {
  if (typeof value !== 'object' || value === null) return current
  const source = value as Partial<Record<keyof Consents, unknown>>
  return {
    bki: typeof source.bki === 'boolean' ? source.bki : current.bki,
    personal_data: typeof source.personal_data === 'boolean' ? source.personal_data : current.personal_data,
    risks: typeof source.risks === 'boolean' ? source.risks : current.risks,
  }
}

function touch(record: MockApplication, now: number) {
  record.app.updated_at = iso(now)
}

function contractNumber(record: MockApplication): string {
  return `ДК-${record.app.number.replace('КР-', '')}`
}

export const applicationHandlers = [
  http.get(
    '/api/applications',
    route(
      ({ db, user }) => {
        const list = findApplicationsOfCompany(db, user.company_id ?? '')
          .sort((a, b) => b.app.updated_at.localeCompare(a.app.updated_at))
          .map(toShort)
        return json(list)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications',
    route(
      async ({ db, user, request, now }) => {
        const body = await readJson<CreateApplicationRequest>(request)
        const product = findProduct(db, String(body.product_code ?? ''))
        if (!product) return apiError(422, 'UNKNOWN_PRODUCT', 'Выберите кредитный продукт')
        const mc = findCompany(db, user.company_id)
        if (!mc) return apiError(409, 'NO_COMPANY', 'Сначала добавьте компанию — заявку подаёт ИП или юрлицо')
        const amount = clamp(toNumber(body.amount, product.min_amount), product.min_amount, product.max_amount)
        const term = clamp(toNumber(body.term, product.min_term), product.min_term, product.max_term)
        const purposeType = isPurpose(body.purpose_type) ? body.purpose_type : product.purpose_types[0]
        const record: MockApplication = {
          app: {
            id: uid(),
            number: nextNumber(db),
            status: 'DRAFT',
            product,
            amount,
            term,
            purpose: typeof body.purpose === 'string' ? body.purpose : '',
            purpose_type: purposeType,
            company: mc.company,
            company_confirmed: false,
            financials: null,
            documents: [],
            consents: { bki: false, personal_data: false, risks: false },
            offer: null,
            info_request: null,
            decision: null,
            contract: null,
            created_at: iso(now),
            submitted_at: null,
            updated_at: iso(now),
          },
          company_id: mc.company.id,
          user_id: user.id,
          scoring: null,
          recommendation: null,
          enriched: false,
          assigned_to: null,
          stage_entered_at: now,
          mock_fail: false,
          mock_fail_event_done: false,
          info_round: 0,
          info_answers: [],
          disburse_at: null,
          disbursed_at: null,
        }
        db.applications.push(record)
        addEvent(db, record, null, 'DRAFT', 'CLIENT', user.full_name, 'Создан черновик заявки', now)
        return json(record.app, 201)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.get(
    '/api/applications/:id',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        return record ? json(record.app) : notFound()
      },
      { role: 'CLIENT' },
    ),
  ),

  http.patch(
    '/api/applications/:id',
    route(
      async (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (record.app.status !== 'DRAFT') return apiError(409, 'NOT_EDITABLE', 'Заявку можно менять только до отправки')
        const body = await readJson<PatchApplicationRequest>(ctx.request)
        const app = record.app
        if (body.product_code !== undefined && body.product_code !== app.product.code) {
          const product = findProduct(ctx.db, String(body.product_code))
          if (!product) return apiError(422, 'UNKNOWN_PRODUCT', 'Такого продукта нет')
          app.product = product
          if (!body.purpose_type && app.purpose_type && !product.purpose_types.includes(app.purpose_type)) {
            app.purpose_type = product.purpose_types[0]
          }
        }
        if (body.amount !== undefined) app.amount = toNumber(body.amount, app.amount)
        if (body.term !== undefined) app.term = toNumber(body.term, app.term)
        app.amount = clamp(app.amount, app.product.min_amount, app.product.max_amount)
        app.term = clamp(app.term, app.product.min_term, app.product.max_term)
        if (typeof body.purpose === 'string') app.purpose = body.purpose.slice(0, 500)
        if (body.purpose_type !== undefined) app.purpose_type = isPurpose(body.purpose_type) ? body.purpose_type : null
        if (typeof body.company_confirmed === 'boolean') app.company_confirmed = body.company_confirmed
        if (body.financials !== undefined) {
          const financials = parseFinancials(body.financials)
          if (!financials) return apiError(422, 'VALIDATION', 'Некорректные финансовые показатели')
          app.financials = financials
        }
        if (body.consents !== undefined) app.consents = parseConsents(body.consents, app.consents)
        const mc = findCompany(ctx.db, record.company_id)
        if (mc) app.company = mc.company
        touch(record, ctx.now)
        return json(app)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/documents',
    route(
      async (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (record.app.status !== 'DRAFT' && record.app.status !== 'NEED_INFO') {
          return apiError(409, 'NOT_EDITABLE', 'Документы можно добавить только в черновик или по запросу банка')
        }
        let form: FormData
        try {
          form = await ctx.request.formData()
        } catch {
          return apiError(422, 'VALIDATION', 'Не удалось прочитать файл')
        }
        const kind = form.get('kind')
        const file = form.get('file')
        if (!isDocumentKind(kind)) return apiError(422, 'VALIDATION', 'Укажите тип документа')
        if (!(file instanceof File)) return apiError(422, 'VALIDATION', 'Файл не выбран')
        if (file.size > MAX_FILE_SIZE) return apiError(422, 'FILE_TOO_LARGE', 'Файл больше 20 МБ')
        const document: AppDocument = { id: uid(), kind, filename: file.name || 'document', size: file.size, created_at: iso(ctx.now) }
        record.app.documents.push(document)
        touch(record, ctx.now)
        return json(document, 201)
      },
      { role: 'CLIENT', delay: [400, 900] },
    ),
  ),

  http.delete(
    '/api/applications/:id/documents/:docId',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (record.app.status !== 'DRAFT' && record.app.status !== 'NEED_INFO') {
          return apiError(409, 'NOT_EDITABLE', 'Документы нельзя удалить после отправки заявки')
        }
        const before = record.app.documents.length
        record.app.documents = record.app.documents.filter((doc) => doc.id !== ctx.params.docId)
        if (record.app.documents.length === before) return apiError(404, 'NOT_FOUND', 'Документ не найден')
        touch(record, ctx.now)
        return noContent()
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/submit',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (record.app.status !== 'DRAFT') return apiError(409, 'INVALID_STATUS', 'Заявка уже отправлена')
        const missing = submitMissing(record)
        if (missing.length) {
          const labels = missing.map((code) => MISSING_LABELS[code] ?? code)
          return apiError(422, 'INCOMPLETE', `Не хватает данных для отправки: ${labels.join(', ')}.`, missing)
        }
        submitApplication(ctx.db, record, ctx.user.full_name, ctx.now, ctx.url.searchParams.get('mock_fail') === '1')
        return json(record.app)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/cancel',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (!CANCELLABLE.includes(record.app.status)) return apiError(409, 'INVALID_STATUS', 'Эту заявку уже нельзя отменить')
        if (record.app.offer && record.app.offer.status === 'PENDING') record.app.offer.status = 'DECLINED'
        setStatus(ctx.db, record, 'CANCELLED', ctx.now, 'CLIENT', ctx.user.full_name, 'Заявка отменена клиентом')
        return json(record.app)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.get(
    '/api/applications/:id/events',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        return record ? json(eventsOf(ctx.db, record.app.id)) : notFound()
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/info-requests/:rid/respond',
    route(
      async (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        const request = record.app.info_request
        if (record.app.status !== 'NEED_INFO' || !request || request.status !== 'OPEN') {
          return apiError(409, 'INVALID_STATUS', 'Банк сейчас не ждёт дополнительной информации')
        }
        if (request.id !== ctx.params.rid) return apiError(404, 'NOT_FOUND', 'Запрос не найден')
        const body = await readJson<{ answers: InfoAnswer[] }>(ctx.request)
        const answers = Array.isArray(body.answers)
          ? body.answers.filter((item): item is InfoAnswer => typeof item?.code === 'string' && typeof item?.value === 'string')
          : []
        const missing = request.items
          .filter((item) => !answers.some((answer) => answer.code === item.code && answer.value.trim()))
          .map((item) => item.label)
        if (missing.length) return apiError(422, 'INCOMPLETE', 'Ответьте на все пункты запроса', missing)
        for (const item of request.items) {
          if (item.type !== 'number') continue
          const answer = answers.find((entry) => entry.code === item.code)
          const value = Number(answer?.value.replace(/[^\d.-]/g, ''))
          if (!Number.isFinite(value) || value < 0) return apiError(422, 'VALIDATION', `Введите число в поле «${item.label}»`, [item.label])
          if (item.code === 'revenue_12m' && record.app.financials) {
            record.app.financials.revenue_12m = Math.round(value)
          }
        }
        record.info_answers = answers
        request.status = 'ANSWERED'
        record.info_round += 1
        record.enriched = false
        record.mock_fail = false
        record.mock_fail_event_done = false
        setStatus(ctx.db, record, 'SUBMITTED', ctx.now, 'CLIENT', ctx.user.full_name, 'Клиент дополнил заявку')
        notify(ctx.db, record, 'APPLICATION_SUBMITTED', 'Заявка дополнена', 'Спасибо! Банк продолжил рассмотрение заявки.', ctx.now)
        return json(record.app)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/offer/accept',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        const offer = record.app.offer
        if (record.app.status !== 'COUNTER_OFFER' || !offer) return apiError(409, 'INVALID_STATUS', 'Нет предложения, ожидающего ответа')
        if (new Date(offer.valid_until).getTime() < ctx.now) {
          offer.status = 'EXPIRED'
          return apiError(409, 'OFFER_EXPIRED', 'Срок действия предложения истёк')
        }
        offer.status = 'ACCEPTED'
        record.app.amount = offer.amount
        record.app.term = offer.term
        record.app.contract = { number: contractNumber(record), signed_at: null }
        setStatus(ctx.db, record, 'APPROVED', ctx.now, 'CLIENT', ctx.user.full_name, 'Клиент принял предложение банка')
        return json(record.app)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/offer/decline',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        const offer = record.app.offer
        if (!offer || (record.app.status !== 'COUNTER_OFFER' && record.app.status !== 'APPROVED')) {
          return apiError(409, 'INVALID_STATUS', 'Нет предложения, ожидающего ответа')
        }
        offer.status = 'DECLINED'
        setStatus(ctx.db, record, 'CLIENT_DECLINED', ctx.now, 'CLIENT', ctx.user.full_name, 'Клиент отклонил предложение банка')
        return json(record.app)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.get(
    '/api/applications/:id/contract',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (!['APPROVED', 'SIGNING', 'SIGNED', 'DISBURSED'].includes(record.app.status)) {
          return apiError(409, 'CONTRACT_NOT_READY', 'Договор будет доступен после одобрения')
        }
        if (!record.app.contract) record.app.contract = { number: contractNumber(record), signed_at: null }
        const contract: Contract = { number: record.app.contract.number, html: contractHtml(record, ctx.now) }
        return json(contract)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/sign',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (record.app.status !== 'APPROVED' && record.app.status !== 'SIGNING') {
          return apiError(409, 'INVALID_STATUS', 'Подписание доступно только для одобренной заявки')
        }
        if (!record.app.contract) record.app.contract = { number: contractNumber(record), signed_at: null }
        if (record.app.status === 'APPROVED') {
          setStatus(ctx.db, record, 'SIGNING', ctx.now, 'CLIENT', ctx.user.full_name, 'Запрошен код подтверждения')
          notify(ctx.db, record, 'CONTRACT_READY', 'Договор готов к подписанию', 'Подтвердите подписание кодом в кабинете.', ctx.now)
        }
        return json({ confirmation_code: '4821' })
      },
      { role: 'CLIENT' },
    ),
  ),

  http.post(
    '/api/applications/:id/sign/confirm',
    route(
      async (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        if (record.app.status !== 'SIGNING') return apiError(409, 'INVALID_STATUS', 'Сначала запросите код подтверждения')
        const body = await readJson<{ code: string }>(ctx.request)
        if (String(body.code ?? '').trim() !== '4821') return apiError(400, 'INVALID_CODE', 'Неверный код подтверждения')
        if (record.app.offer) record.app.offer.status = 'ACCEPTED'
        if (record.app.contract) record.app.contract.signed_at = iso(ctx.now)
        else record.app.contract = { number: contractNumber(record), signed_at: iso(ctx.now) }
        if (record.app.offer) {
          record.app.amount = record.app.offer.amount
          record.app.term = record.app.offer.term
        }
        setStatus(ctx.db, record, 'SIGNED', ctx.now, 'CLIENT', ctx.user.full_name, 'Договор подписан простой электронной подписью')
        record.disburse_at = ctx.now + 3000
        return json(record.app)
      },
      { role: 'CLIENT' },
    ),
  ),

  http.get(
    '/api/applications/:id/schedule',
    route(
      (ctx) => {
        const record = ownApplication(ctx, ctx.params.id)
        if (!record) return notFound()
        const app = record.app
        const rate = app.offer?.rate ?? app.product.base_rate
        const amount = app.offer?.amount ?? app.amount
        const term = app.offer?.term ?? app.term
        const start = record.disbursed_at ? new Date(record.disbursed_at) : new Date(ctx.now)
        return json(buildSchedule(amount, term, rate, start))
      },
      { role: 'CLIENT' },
    ),
  ),
]


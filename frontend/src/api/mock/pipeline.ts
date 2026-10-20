import type { ActorType, ApplicationStatus, DecisionType, InfoRequestItem, NotificationType, Offer } from '@/api/types'
import { loanSummary } from '@/shared/lib/annuity'
import { findCompany, type MockApplication, type MockDb } from './db'
import { companyLoans, derivedFinancials } from './insights'
import { computeRecommendation, computeScoring } from './scoring'
import { clamp, dateRu, DAY, iso, money, uid, rateText } from './utils'

export const SYSTEM_ACTOR = 'Кредитный конвейер'
export const STAGE_MS = 2000
export const MOCK_FAIL_ENRICH_MS = 6000
export const DISBURSE_DELAY_MS = 3000
export const MANUAL_REVIEW_THRESHOLD = 5_000_000

const NEXT_STAGE: Partial<Record<ApplicationStatus, ApplicationStatus>> = {
  SUBMITTED: 'VALIDATING',
  VALIDATING: 'ENRICHING',
  ENRICHING: 'SCORING',
  SCORING: 'DECIDING',
}

const STAGE_COPY: Partial<Record<ApplicationStatus, { reason: string; title: string; body: string }>> = {
  VALIDATING: {
    reason: 'Заявка принята в обработку',
    title: 'Заявка принята в работу',
    body: 'Проверяем полноту и корректность данных.',
  },
  ENRICHING: {
    reason: 'Проверка полноты и корректности пройдена',
    title: 'Проверка данных пройдена',
    body: 'Запрашиваем сведения в ЕГРЮЛ, ФНС и бюро кредитных историй.',
  },
  SCORING: {
    reason: 'Получены данные ЕГРЮЛ, ФНС и БКИ',
    title: 'Данные из внешних источников получены',
    body: 'Оцениваем финансовое состояние бизнеса.',
  },
  DECIDING: {
    reason: 'Скоринговая оценка рассчитана',
    title: 'Оценка завершена',
    body: 'Формируем решение по заявке.',
  },
}

export function addEvent(
  db: MockDb,
  record: MockApplication,
  from: ApplicationStatus | null,
  to: ApplicationStatus,
  actorType: ActorType,
  actorName: string,
  reason: string | null,
  at: number,
): void {
  db.events.push({
    id: uid(),
    application_id: record.app.id,
    from_status: from,
    to_status: to,
    actor_type: actorType,
    actor_name: actorName,
    reason,
    created_at: iso(at),
  })
}

export function notify(
  db: MockDb,
  record: MockApplication,
  type: NotificationType,
  title: string,
  body: string,
  at: number,
): void {
  if (!record.user_id) return
  db.notifications.push({
    id: uid(),
    user_id: record.user_id,
    application_id: record.app.id,
    type,
    title,
    body,
    is_read: false,
    created_at: iso(at),
  })
}

export function setStatus(
  db: MockDb,
  record: MockApplication,
  to: ApplicationStatus,
  at: number,
  actorType: ActorType,
  actorName: string,
  reason: string | null,
): void {
  const from = record.app.status
  record.app.status = to
  record.app.updated_at = iso(at)
  record.stage_entered_at = at
  addEvent(db, record, from, to, actorType, actorName, reason, at)
}

export function createOffer(record: MockApplication, amount: number, term: number, rate: number, isCounter: boolean, at: number): Offer {
  const base = record.app.product.base_rate
  return {
    id: uid(),
    amount,
    term,
    rate,
    monthly_payment: loanSummary(amount, term, rate).monthly_payment,
    is_counter: isCounter,
    status: 'PENDING',
    valid_until: iso(at + 14 * DAY),
    requested: {
      amount: record.app.amount,
      term: record.app.term,
      rate: base,
      monthly_payment: loanSummary(record.app.amount, record.app.term, base).monthly_payment,
    },
  }
}

function contractNumber(record: MockApplication): string {
  return `ДК-${record.app.number.replace('КР-', '')}`
}

export interface DecisionInput {
  type: DecisionType
  amount?: number
  term?: number
  rate?: number
  reasons: string[]
  items?: InfoRequestItem[]
  comment?: string
}

export function applyDecision(
  db: MockDb,
  record: MockApplication,
  input: DecisionInput,
  actorType: ActorType,
  actorName: string,
  at: number,
): void {
  const app = record.app
  const product = app.product
  app.decision = { type: input.type, made_by: actorName, reasons: input.reasons, created_at: iso(at) }
  const reasonText = input.comment?.trim() || input.reasons[0] || null

  if (input.type === 'APPROVED') {
    const amount = input.amount ?? app.amount
    const term = input.term ?? app.term
    const rate = input.rate ?? product.base_rate
    app.offer = createOffer(record, amount, term, rate, amount !== app.amount || term !== app.term, at)
    app.contract = { number: contractNumber(record), signed_at: null }
    setStatus(db, record, 'APPROVED', at, actorType, actorName, reasonText ?? 'Кредит одобрен')
    notify(
      db,
      record,
      'DECISION_MADE',
      'Кредит одобрен',
      `${money(amount)} на ${term} мес. под ${rateText(rate)} годовых. Проверьте условия и перейдите к подписанию договора.`,
      at,
    )
    return
  }

  if (input.type === 'COUNTER_OFFER') {
    const amount = input.amount ?? app.amount
    const term = input.term ?? app.term
    const rate = input.rate ?? product.base_rate
    app.offer = createOffer(record, amount, term, rate, true, at)
    setStatus(db, record, 'COUNTER_OFFER', at, actorType, actorName, reasonText ?? 'Предложены другие условия')
    notify(
      db,
      record,
      'OFFER_PENDING',
      'Банк предлагает другие условия',
      `${money(amount)} на ${term} мес. под ${rateText(rate)} годовых. Предложение действует до ${dateRu(app.offer.valid_until)}.`,
      at,
    )
    return
  }

  if (input.type === 'NEED_INFO') {
    const items = input.items ?? []
    app.info_request = { id: uid(), items, comment: input.comment ?? '', status: 'OPEN' }
    setStatus(db, record, 'NEED_INFO', at, actorType, actorName, reasonText ?? 'Запрошена дополнительная информация')
    notify(
      db,
      record,
      'INFO_REQUESTED',
      'Нужна дополнительная информация',
      `Банк просит: ${items.map((item) => item.label.toLowerCase()).join('; ')}.`,
      at,
    )
    return
  }

  if (input.type === 'MANUAL_REVIEW') {
    setStatus(db, record, 'MANUAL_REVIEW', at, actorType, actorName, reasonText ?? 'Передана на рассмотрение специалисту')
    notify(
      db,
      record,
      'DECISION_MADE',
      'Заявка передана специалисту',
      'Кредитный специалист изучит заявку. Обычно это занимает до 1 рабочего дня.',
      at,
    )
    return
  }

  setStatus(db, record, 'REJECTED', at, actorType, actorName, reasonText ?? 'Отказ')
  notify(
    db,
    record,
    'DECISION_MADE',
    'Решение по заявке',
    'К сожалению, банк не может выдать кредит на запрошенных условиях. Причины — в карточке заявки.',
    at,
  )
}

export const CLIENT5_INFO_ITEMS: InfoRequestItem[] = [
  { code: 'revenue_12m', label: 'Уточните выручку за 12 месяцев', type: 'number' },
  { code: 'statement_6m', label: 'Выписка по счёту за 6 месяцев', type: 'document' },
]

export function computeAssessment(db: MockDb, record: MockApplication, at: number): void {
  const mc = findCompany(db, record.company_id)
  if (!mc) return
  const financials = record.app.financials ?? derivedFinancials(db, mc, at)
  const scoring = computeScoring(mc, record.app, financials, companyLoans(db, mc, at), at)
  record.scoring = scoring
  record.recommendation = computeRecommendation(scoring, record.app)
  record.enriched = true
}

function applyOutcome(db: MockDb, record: MockApplication, at: number): void {
  const mc = findCompany(db, record.company_id)
  const app = record.app
  const product = app.product
  const base = product.base_rate
  const key = mc?.key ?? 'background'

  if (key === 'client1') {
    if (app.amount <= MANUAL_REVIEW_THRESHOLD) {
      applyDecision(db, record, { type: 'APPROVED', rate: base, reasons: ['Высокий балл скоринга', 'Нет стоп-факторов'] }, 'SYSTEM', SYSTEM_ACTOR, at)
    } else {
      applyDecision(
        db,
        record,
        { type: 'MANUAL_REVIEW', reasons: [`Сумма выше порога автоматического решения ${money(MANUAL_REVIEW_THRESHOLD)}`] },
        'SYSTEM',
        SYSTEM_ACTOR,
        at,
      )
    }
    return
  }

  if (key === 'client2') {
    if (app.amount > 1_000_000) {
      applyDecision(
        db,
        record,
        {
          type: 'COUNTER_OFFER',
          amount: Math.max(product.min_amount, 1_000_000),
          term: clamp(app.term, product.min_term, product.max_term),
          rate: base + 1,
          reasons: ['Бизнесу меньше года — лимит ограничен суммой 1 000 000 ₽', 'Короткая история оборотов по счёту'],
        },
        'SYSTEM',
        SYSTEM_ACTOR,
        at,
      )
    } else {
      applyDecision(
        db,
        record,
        { type: 'APPROVED', rate: base + 2, reasons: ['Короткая история бизнеса — ставка выше базовой на 2 п.п.'] },
        'SYSTEM',
        SYSTEM_ACTOR,
        at,
      )
    }
    return
  }

  if (key === 'client3') {
    applyDecision(
      db,
      record,
      { type: 'MANUAL_REVIEW', reasons: ['В кредитной истории есть просрочка 45 дней', 'Нужна экспертная оценка специалиста'] },
      'SYSTEM',
      SYSTEM_ACTOR,
      at,
    )
    return
  }

  if (key === 'client4') {
    applyDecision(
      db,
      record,
      { type: 'REJECTED', reasons: ['Просрочка по кредитам свыше 180 дней', 'Налоговая задолженность 312 000 ₽'] },
      'SYSTEM',
      SYSTEM_ACTOR,
      at,
    )
    return
  }

  if (key === 'client5') {
    if (record.info_round === 0) {
      applyDecision(
        db,
        record,
        {
          type: 'NEED_INFO',
          items: CLIENT5_INFO_ITEMS,
          reasons: ['Выручка в заявке расходится с данными ФНС'],
          comment: 'Выручка в заявке заметно выше, чем в налоговой декларации. Уточните цифру и приложите выписку.',
        },
        'SYSTEM',
        SYSTEM_ACTOR,
        at,
      )
    } else {
      applyDecision(
        db,
        record,
        { type: 'APPROVED', rate: base + 0.5, reasons: ['Расхождение с данными ФНС пояснено', 'Выписка подтверждает обороты'] },
        'SYSTEM',
        SYSTEM_ACTOR,
        at,
      )
    }
    return
  }

  const recommendation = record.recommendation
  const grade = record.scoring?.grade ?? 'C'
  if (recommendation?.type === 'REJECTED' || grade === 'D') {
    applyDecision(db, record, { type: 'REJECTED', reasons: recommendation?.reasons ?? ['Низкий балл скоринга'] }, 'SYSTEM', SYSTEM_ACTOR, at)
  } else if (grade === 'C' || app.amount > MANUAL_REVIEW_THRESHOLD) {
    applyDecision(db, record, { type: 'MANUAL_REVIEW', reasons: ['Нужна экспертная оценка специалиста'] }, 'SYSTEM', SYSTEM_ACTOR, at)
  } else {
    applyDecision(
      db,
      record,
      { type: 'APPROVED', rate: recommendation?.rate ?? base, reasons: recommendation?.reasons ?? ['Положительная оценка'] },
      'SYSTEM',
      SYSTEM_ACTOR,
      at,
    )
  }
}

function advanceRecord(db: MockDb, record: MockApplication, now: number): void {
  for (let guard = 0; guard < 12; guard += 1) {
    const status = record.app.status
    const entered = record.stage_entered_at

    const next = NEXT_STAGE[status]
    if (next || status === 'DECIDING') {
      const failing = status === 'ENRICHING' && record.mock_fail
      if (failing && !record.mock_fail_event_done && now >= entered + STAGE_MS) {
        addEvent(
          db,
          record,
          'ENRICHING',
          'ENRICHING',
          'SYSTEM',
          SYSTEM_ACTOR,
          'Бюро кредитных историй не ответило — повторный запрос в БКИ',
          entered + STAGE_MS,
        )
        record.mock_fail_event_done = true
      }
      const duration = failing ? MOCK_FAIL_ENRICH_MS : STAGE_MS
      if (now - entered < duration) return
      const at = entered + duration
      if (status === 'DECIDING') {
        applyOutcome(db, record, at)
        continue
      }
      if (next === 'SCORING' || (next === 'DECIDING' && !record.enriched)) computeAssessment(db, record, at)
      const copy = next ? STAGE_COPY[next] : undefined
      if (next) {
        setStatus(db, record, next, at, 'SYSTEM', SYSTEM_ACTOR, copy?.reason ?? null)
        if (copy) notify(db, record, 'STAGE_PASSED', copy.title, copy.body, at)
      }
      continue
    }

    if (status === 'SIGNED' && record.disburse_at !== null && now >= record.disburse_at) {
      const at = record.disburse_at
      record.disbursed_at = iso(at)
      record.disburse_at = null
      setStatus(db, record, 'DISBURSED', at, 'SYSTEM', SYSTEM_ACTOR, 'Средства перечислены на расчётный счёт')
      notify(
        db,
        record,
        'DISBURSED',
        'Средства зачислены на расчётный счёт',
        `${money(record.app.amount)} по договору ${record.app.contract?.number ?? ''}. График платежей — в карточке заявки.`,
        at,
      )
      continue
    }
    return
  }
}

export function advanceAll(db: MockDb, now: number): void {
  for (const record of db.applications) advanceRecord(db, record, now)
}

export const MISSING_LABELS: Record<string, string> = {
  product: 'кредитный продукт',
  amount: 'сумма в пределах продукта',
  term: 'срок в пределах продукта',
  company_confirmed: 'подтверждение данных компании',
  financials: 'финансовые показатели',
  equipment_invoice: 'счёт на оборудование',
  consent_bki: 'согласие на запрос в бюро кредитных историй',
  consent_personal_data: 'согласие на обработку персональных данных',
  consent_risks: 'подтверждение ознакомления с рисками',
}

export function submitMissing(record: MockApplication): string[] {
  const app = record.app
  const product = app.product
  const missing: string[] = []
  if (!product) return ['product']
  if (app.amount < product.min_amount || app.amount > product.max_amount) missing.push('amount')
  if (app.term < product.min_term || app.term > product.max_term) missing.push('term')
  if (!app.company_confirmed) missing.push('company_confirmed')
  if (!app.financials) missing.push('financials')
  if (product.requires_invoice && !app.documents.some((doc) => doc.kind === 'EQUIPMENT_INVOICE')) missing.push('equipment_invoice')
  if (!app.consents.bki) missing.push('consent_bki')
  if (!app.consents.personal_data) missing.push('consent_personal_data')
  if (!app.consents.risks) missing.push('consent_risks')
  return missing
}

export function submitApplication(db: MockDb, record: MockApplication, actorName: string, now: number, mockFail: boolean): void {
  record.mock_fail = mockFail
  record.mock_fail_event_done = false
  record.enriched = false
  record.app.submitted_at = iso(now)
  setStatus(db, record, 'SUBMITTED', now, 'CLIENT', actorName, 'Заявка отправлена клиентом')
  notify(db, record, 'APPLICATION_SUBMITTED', 'Заявка отправлена', `Заявка ${record.app.number} принята банком. Статус обновляется автоматически.`, now)
}

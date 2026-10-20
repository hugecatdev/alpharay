import type { ActiveLoan, Application, Discrepancy, Financials, Grade, Recommendation, Scoring, ScoringFactor } from '@/api/types'
import { annuityPayment } from '@/shared/lib/annuity'
import type { MockCompany } from './db'
import { ageLabel, lowerFirst, money, monthsBetween, percent, roundTo } from './utils'

function ratioLabel(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}×`
}

export function stopFactors(mc: MockCompany): string[] {
  const list: string[] = []
  if (mc.fns.tax_debt > 0) list.push(`Налоговая задолженность ${money(mc.fns.tax_debt)}`)
  if (mc.fns.account_blocks) list.push('Блокировки расчётных счетов по решению ФНС')
  if (mc.bki.max_overdue_days_24m > 90) list.push(`Просрочка по кредитам ${mc.bki.max_overdue_days_24m} дней`)
  if (mc.fns.disqualified_head) list.push('Руководитель дисквалифицирован')
  if (mc.fns.mass_address) list.push('Адрес массовой регистрации')
  return list
}

function factor(code: string, name: string, value: string, points: number, max: number, comment: string): ScoringFactor {
  return { code, name, value, points: Math.max(0, Math.min(max, points)), max_points: max, comment }
}

export function computeScoring(mc: MockCompany, app: Application, financials: Financials, loans: ActiveLoan[], now: number): Scoring {
  const factors: ScoringFactor[] = []

  const age = monthsBetween(mc.company.registration_date, now)
  const agePoints = age >= 60 ? 15 : age >= 36 ? 12 : age >= 24 ? 9 : age >= 12 ? 6 : 2
  factors.push(
    factor(
      'business_age',
      'Возраст бизнеса',
      ageLabel(age),
      agePoints,
      15,
      age >= 36 ? 'Бизнес работает устойчиво несколько лет' : age >= 12 ? 'Короткая история работы' : 'Бизнесу меньше года — мало данных для оценки',
    ),
  )

  const revenue = financials.revenue_12m
  const ratio = app.amount > 0 ? revenue / app.amount : 0
  const ratioPoints = ratio >= 10 ? 20 : ratio >= 6 ? 16 : ratio >= 3 ? 11 : ratio >= 1.5 ? 6 : 2
  factors.push(
    factor(
      'revenue_to_amount',
      'Выручка к сумме кредита',
      ratioLabel(ratio),
      ratioPoints,
      20,
      ratio >= 6 ? 'Сумма кредита небольшая относительно оборота' : ratio >= 3 ? 'Сумма соразмерна обороту' : 'Сумма велика относительно годовой выручки',
    ),
  )

  const newPayment = annuityPayment(app.amount, app.term, app.product.base_rate)
  const existing = financials.monthly_debt_payments || loans.reduce((sum, loan) => sum + loan.monthly_payment, 0)
  const monthlyRevenue = revenue / 12 || 1
  const load = ((existing + newPayment) / monthlyRevenue) * 100
  const loadPoints = load <= 10 ? 20 : load <= 20 ? 15 : load <= 30 ? 10 : load <= 45 ? 5 : 0
  factors.push(
    factor(
      'debt_load',
      'Долговая нагрузка',
      `${percent(load)} выручки`,
      loadPoints,
      20,
      load <= 20 ? 'Платежи по кредитам занимают небольшую долю выручки' : load <= 30 ? 'Нагрузка умеренная' : 'Высокая доля выручки уходит на платежи',
    ),
  )

  const overdue = mc.bki.max_overdue_days_24m
  const disciplinePoints = overdue === 0 ? 15 : overdue <= 5 ? 12 : overdue <= 30 ? 8 : overdue <= 90 ? 4 : 0
  factors.push(
    factor(
      'payment_discipline',
      'Платёжная дисциплина',
      overdue === 0 ? 'без просрочек' : `просрочка до ${overdue} дн.`,
      disciplinePoints,
      15,
      overdue === 0 ? 'Обязательства исполнялись вовремя' : overdue <= 30 ? 'Были короткие просрочки' : 'Существенная просрочка за последние 24 месяца',
    ),
  )

  const rating = mc.bki.rating
  const ratingPoints = rating >= 800 ? 10 : rating >= 700 ? 8 : rating >= 600 ? 6 : rating >= 450 ? 3 : 0
  factors.push(factor('bki_rating', 'Рейтинг БКИ', `${rating} — ${mc.bki.rating_label}`, ratingPoints, 10, 'Оценка бюро кредитных историй'))

  const turnover = mc.turnover
  const half = Math.max(1, Math.floor(turnover.length / 2))
  const first = turnover.slice(0, half).reduce((sum, month) => sum + month.inflow, 0) / half
  const second = turnover.slice(-half).reduce((sum, month) => sum + month.inflow, 0) / half
  const growth = first > 0 ? ((second - first) / first) * 100 : 0
  const growthPoints = growth >= 10 ? 10 : growth >= 0 ? 8 : growth >= -10 ? 5 : 1
  factors.push(
    factor(
      'revenue_trend',
      'Динамика выручки',
      `${growth >= 0 ? '+' : ''}${percent(growth)} за полгода`,
      growthPoints,
      10,
      growth >= 0 ? 'Обороты растут или стабильны' : growth >= -10 ? 'Небольшое снижение оборотов' : 'Обороты заметно снижаются',
    ),
  )

  const margin = revenue > 0 ? (financials.net_profit_12m / revenue) * 100 : 0
  const marginPoints = margin >= 15 ? 10 : margin >= 8 ? 8 : margin >= 3 ? 5 : margin >= 0 ? 3 : 0
  factors.push(
    factor(
      'profitability',
      'Рентабельность',
      percent(margin, 1),
      marginPoints,
      10,
      margin >= 8 ? 'Бизнес стабильно прибыльный' : margin >= 0 ? 'Невысокая маржа' : 'Деятельность убыточна',
    ),
  )

  const score = factors.reduce((sum, item) => sum + item.points, 0)
  const stops = stopFactors(mc)
  const grade: Grade = stops.length ? 'D' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D'
  return { score, grade, factors, stop_factors: stops, model_version: 'rules-v1.2' }
}

export function computeRecommendation(scoring: Scoring, app: Application): Recommendation {
  const base = app.product.base_rate
  if (scoring.stop_factors.length) {
    return { type: 'REJECTED', reasons: scoring.stop_factors }
  }
  if (scoring.grade === 'A') {
    return { type: 'APPROVED', amount: app.amount, term: app.term, rate: base, reasons: ['Высокий балл скоринга', 'Нет стоп-факторов'] }
  }
  if (scoring.grade === 'B') {
    return {
      type: 'APPROVED',
      amount: app.amount,
      term: app.term,
      rate: base + 1.5,
      reasons: ['Хороший балл скоринга', 'Ставка повышена с учётом умеренного риска'],
    }
  }
  if (scoring.grade === 'C') {
    const amount = Math.max(app.product.min_amount, roundTo(app.amount * 0.7, 50_000))
    const weak = scoring.factors.filter((item) => item.points / item.max_points <= 0.35).map((item) => lowerFirst(item.name))
    return {
      type: 'COUNTER_OFFER',
      amount,
      term: app.term,
      rate: base + 2,
      reasons: ['Средний балл скоринга', weak.length ? `Слабые факторы: ${weak.join(', ')}` : 'Рекомендуется снизить сумму'],
    }
  }
  return { type: 'REJECTED', reasons: ['Низкий балл скоринга'] }
}

export function computeDiscrepancies(mc: MockCompany, app: Application): Discrepancy[] {
  if (!app.financials) return []
  const result: Discrepancy[] = []
  const declared = app.financials.revenue_12m
  const external = mc.fns.declared_revenue_12m
  if (external > 0) {
    const diff = ((declared - external) / external) * 100
    if (Math.abs(diff) >= 10) {
      result.push({
        field: 'revenue_12m',
        label: 'Выручка за 12 месяцев',
        declared,
        external,
        diff_percent: Math.round(diff * 10) / 10,
      })
    }
  }
  if (app.financials.employees_count > 0 && mc.company.employees_count > 0) {
    const diff = ((app.financials.employees_count - mc.company.employees_count) / mc.company.employees_count) * 100
    if (Math.abs(diff) >= 30) {
      result.push({
        field: 'employees_count',
        label: 'Численность сотрудников',
        declared: app.financials.employees_count,
        external: mc.company.employees_count,
        diff_percent: Math.round(diff * 10) / 10,
      })
    }
  }
  return result
}

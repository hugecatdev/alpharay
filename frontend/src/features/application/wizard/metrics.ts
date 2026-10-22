import type { CompanyInsights, Product, Repayment } from '@/api'
import { annuityPayment, creditSummary, maxAmountForPayment } from '@/shared/lib/annuity'
import { formatMoneyShort, formatPercent } from '@/shared/lib/money'

export const COMFORT_LOAD = 0.4
export const HIGH_LOAD = 0.7
export const OVERDRAFT_INFLOW_SHARE = 0.5

export type RiskLevel = 'low' | 'medium' | 'high'
export type CheckLevel = 'ok' | 'warn' | 'bad'

export interface FcfMonth {
  month: string
  value: number
}

export interface LoanMetrics {
  revolving: boolean
  monthly: number
  overpayment: number
  total: number
  overpaymentShare: number
  existing: number
  avgFcf: number | null
  flow: number | null
  avgInflow: number | null
  annualInflow: number | null
  share: number | null
  existingShare: number | null
  reserve: number | null
  fcf: FcfMonth[]
  fitCount: number
  badMonths: string[]
  riskLevel: RiskLevel
}

export function round50k(value: number): number {
  return Math.round(value / 50_000) * 50_000
}

export function floor50k(value: number): number {
  return Math.floor(value / 50_000) * 50_000
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function lastTwelve(insights: CompanyInsights | undefined): FcfMonth[] {
  if (!insights) return []
  return insights.turnover.slice(-12).map((month) => ({ month: month.month, value: month.inflow - month.outflow }))
}

export function existingPayments(insights: CompanyInsights | undefined): number {
  return insights ? insights.loans.reduce((sum, loan) => sum + loan.monthly_payment, 0) : 0
}

export function computeMetrics(
  amount: number,
  term: number,
  rate: number,
  insights?: CompanyInsights,
  repayment: Repayment = 'ANNUITY',
): LoanMetrics {
  const summary = creditSummary(repayment, amount, term, rate)
  const fcf = lastTwelve(insights)
  const months = insights?.turnover.slice(-12) ?? []
  const annualInflow = months.length ? months.reduce((sum, month) => sum + month.inflow, 0) : null
  const avgInflow = annualInflow !== null && months.length ? annualInflow / months.length : null
  const avgFcf = insights && fcf.length ? insights.avg_free_cash_flow : null
  const existing = existingPayments(insights)
  const flow = avgFcf === null ? null : avgFcf + existing
  const share = flow === null ? null : flow > 0 ? (existing + summary.monthly_payment) / flow : Infinity
  const existingShare = flow === null ? null : flow > 0 ? existing / flow : Infinity
  const reserve =
    avgFcf !== null && avgInflow ? Math.max(0, (avgFcf - summary.monthly_payment) / avgInflow) : null
  const badMonths = fcf.filter((month) => month.value < summary.monthly_payment).map((month) => month.month)
  const riskLevel: RiskLevel = share === null ? 'medium' : share <= COMFORT_LOAD ? 'low' : share <= HIGH_LOAD ? 'medium' : 'high'
  return {
    revolving: repayment === 'REVOLVING',
    monthly: summary.monthly_payment,
    overpayment: summary.overpayment,
    total: summary.total_payment,
    overpaymentShare: amount > 0 ? summary.overpayment / amount : 0,
    existing,
    avgFcf,
    flow,
    avgInflow,
    annualInflow,
    share,
    existingShare,
    reserve,
    fcf,
    fitCount: fcf.length - badMonths.length,
    badMonths,
    riskLevel,
  }
}

export function sharePercent(share: number | null): number | null {
  if (share === null) return null
  if (!Number.isFinite(share)) return 999
  return Math.round(share * 100)
}

export function formatShare(share: number | null): string {
  if (share === null) return '—'
  if (!Number.isFinite(share) || share > 9.99) return 'больше 999%'
  return formatPercent(share * 100)
}

export interface CheckFix {
  label: string
  amount?: number
  term?: number
}

export interface CheckItem {
  id: string
  level: CheckLevel
  text: string
  hint: string
  fix?: CheckFix
}

export interface PrecheckResult {
  level: CheckLevel
  items: CheckItem[]
}

export const checkLevelMeta: Record<CheckLevel, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  ok: { label: 'Высокая', tone: 'success' },
  warn: { label: 'Средняя', tone: 'warning' },
  bad: { label: 'Низкая', tone: 'danger' },
}

function termFor(amount: number, rate: number, product: Product, from: number, accept: (payment: number, term: number) => boolean) {
  for (let term = from + 1; term <= product.max_term; term += 1) {
    if (accept(annuityPayment(amount, term, rate), term)) return term
  }
  return null
}

export function runPrecheck(
  amount: number,
  term: number,
  rate: number,
  product: Product,
  insights: CompanyInsights | undefined,
): PrecheckResult {
  const metrics = computeMetrics(amount, term, rate, insights, product.repayment)
  const items: CheckItem[] = []

  if (insights && insights.pre_approved_limit > 0 && amount > insights.pre_approved_limit) {
    const target = clamp(floor50k(insights.pre_approved_limit), product.min_amount, product.max_amount)
    items.push({
      id: 'limit',
      level: 'warn',
      text: `Сумма выше предварительного лимита ${formatMoneyShort(insights.pre_approved_limit)}`,
      hint: 'Лимит посчитан по оборотам счёта с учётом текущих кредитов. Скорее всего, банк предложит меньшую сумму или попросит обеспечение.',
      fix: target < amount ? { label: `Уменьшить до ${formatMoneyShort(target)}`, amount: target } : undefined,
    })
  }

  if (!metrics.fcf.length) {
    items.push({
      id: 'no-data',
      level: 'warn',
      text: 'Нет оборотов по вашему счёту в AlphaRay',
      hint: 'Заранее оценить нагрузку не получится — банк проверит её по выписке и данным ФНС.',
    })
  }

  const flow = metrics.flow
  if (flow !== null && metrics.share !== null && metrics.share > COMFORT_LOAD) {
    const bad = metrics.share > HIGH_LOAD
    const room = flow * COMFORT_LOAD - metrics.existing
    let fix: CheckFix | undefined
    if (room > 0 && metrics.revolving) {
      const capAmount = floor50k((room * 1200) / rate)
      if (capAmount >= product.min_amount && capAmount < amount) fix = { label: `Уменьшить лимит до ${formatMoneyShort(capAmount)}`, amount: capAmount }
    } else if (room > 0) {
      const fitTerm = termFor(amount, rate, product, term, (payment) => payment <= room)
      const capAmount = floor50k(maxAmountForPayment(room, term, rate))
      fix = fitTerm
        ? { label: `Увеличить срок до ${fitTerm} мес.`, term: fitTerm }
        : capAmount >= product.min_amount && capAmount < amount
          ? { label: `Уменьшить сумму до ${formatMoneyShort(capAmount)}`, amount: capAmount }
          : undefined
    }
    const existingNote =
      metrics.existing > 0 ? ` Из них текущие кредиты — ${formatShare(metrics.existingShare)}.` : ''
    items.push({
      id: 'load',
      level: bad ? 'bad' : 'warn',
      text: `Платежи по всем кредитам займут ${formatShare(metrics.share)} денежного потока (${formatMoneyShort(flow)} в мес.)`,
      hint:
        (room <= 0
          ? 'Текущие кредиты уже занимают комфортные 40% потока — новый кредит разумнее брать после погашения части долга.'
          : bad
            ? 'Почти все свободные деньги будут уходить на кредиты — любой спад выручки приведёт к просрочке.'
            : 'Комфортно — до 40%. На непредвиденные расходы останется немного — держите резерв хотя бы на 2–3 платежа.') +
        existingNote,
      fix,
    })
  }

  if (metrics.revolving && metrics.avgInflow !== null && amount > metrics.avgInflow * OVERDRAFT_INFLOW_SHARE) {
    const target = clamp(floor50k(metrics.avgInflow * OVERDRAFT_INFLOW_SHARE), product.min_amount, product.max_amount)
    items.push({
      id: 'inflow',
      level: 'warn',
      text: 'Лимит больше половины среднемесячных поступлений на счёт',
      hint: 'Овердрафт гасится поступлениями. Банк обычно ставит лимит до 30–50% месячного оборота по счёту.',
      fix: target < amount ? { label: `Уменьшить до ${formatMoneyShort(target)}`, amount: target } : undefined,
    })
  }

  if (!metrics.revolving && metrics.annualInflow !== null && amount > metrics.annualInflow * 0.5) {
    const target = clamp(floor50k(metrics.annualInflow * 0.5), product.min_amount, product.max_amount)
    items.push({
      id: 'revenue',
      level: 'warn',
      text: 'Сумма больше половины годовых поступлений на счёт',
      hint: 'Для бизнеса такого оборота это крупный долг — банк проверит его особенно внимательно.',
      fix: target < amount ? { label: `Уменьшить до ${formatMoneyShort(target)}`, amount: target } : undefined,
    })
  }

  if (
    !metrics.revolving &&
    metrics.fcf.length &&
    metrics.badMonths.length > 3 &&
    !items.some((item) => item.id === 'load' && item.fix?.term)
  ) {
    const values = metrics.fcf.map((month) => month.value)
    const fitTerm = termFor(amount, rate, product, term, (payment) => values.filter((value) => value < payment).length <= 3)
    items.push({
      id: 'months',
      level: 'warn',
      text: `Новый платёж не покрывается потоком в ${metrics.badMonths.length} мес. из ${metrics.fcf.length}`,
      hint: 'В эти месяцы после текущих платежей денег на новый не хватит — платить придётся из резервов.',
      fix: fitTerm ? { label: `Увеличить срок до ${fitTerm} мес.`, term: fitTerm } : undefined,
    })
  }

  const level: CheckLevel = items.some((item) => item.level === 'bad')
    ? 'bad'
    : items.some((item) => item.level === 'warn')
      ? 'warn'
      : 'ok'
  return { level, items }
}

export function defaultAmount(product: Product, insights?: CompanyInsights): number {
  const fallback = Math.max(product.min_amount, 1_000_000)
  if (!insights || !insights.turnover.length) return clamp(round50k(fallback), product.min_amount, product.max_amount)
  const metrics = computeMetrics(0, defaultTerm(product), product.base_rate, insights, product.repayment)
  const room = (metrics.flow ?? 0) * COMFORT_LOAD - metrics.existing
  const comfortable =
    room <= 0
      ? product.min_amount
      : product.repayment === 'REVOLVING'
        ? Math.min((room * 1200) / product.base_rate, (metrics.avgInflow ?? 0) * 0.3)
        : maxAmountForPayment(room, defaultTerm(product), product.base_rate)
  const limit = insights.pre_approved_limit > 0 ? insights.pre_approved_limit : comfortable
  return clamp(floor50k(Math.min(limit, comfortable)), product.min_amount, product.max_amount)
}

export function defaultTerm(product: Product): number {
  const preferred = product.max_term <= 12 ? product.max_term : product.max_term <= 36 ? 24 : 36
  return clamp(preferred, product.min_term, product.max_term)
}

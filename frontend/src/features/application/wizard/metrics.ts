import type { CompanyInsights, Product } from '@/api'
import { annuityPayment, loanSummary, maxAmountForPayment } from '@/shared/lib/annuity'
import { formatMoneyShort, formatPercent } from '@/shared/lib/money'

export type RiskLevel = 'low' | 'medium' | 'high'
export type CheckLevel = 'ok' | 'warn' | 'bad'

export interface FcfMonth {
  month: string
  value: number
}

export interface LoanMetrics {
  monthly: number
  overpayment: number
  total: number
  overpaymentShare: number
  avgFcf: number | null
  avgInflow: number | null
  annualInflow: number | null
  share: number | null
  shareAfterDrop: number | null
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

export function computeMetrics(amount: number, term: number, rate: number, insights?: CompanyInsights): LoanMetrics {
  const summary = loanSummary(amount, term, rate)
  const fcf = lastTwelve(insights)
  const months = insights?.turnover.slice(-12) ?? []
  const annualInflow = months.length ? months.reduce((sum, month) => sum + month.inflow, 0) : null
  const avgInflow = annualInflow !== null && months.length ? annualInflow / months.length : null
  const avgFcf = insights
    ? insights.avg_free_cash_flow || (fcf.length ? fcf.reduce((sum, month) => sum + month.value, 0) / fcf.length : null)
    : null
  const share = avgFcf && avgFcf > 0 ? summary.monthly_payment / avgFcf : avgFcf !== null ? Infinity : null
  const droppedFcf = avgFcf !== null && avgInflow !== null ? avgFcf - avgInflow * 0.2 : null
  const shareAfterDrop = droppedFcf === null ? null : droppedFcf > 0 ? summary.monthly_payment / droppedFcf : Infinity
  const badMonths = fcf.filter((month) => month.value < summary.monthly_payment).map((month) => month.month)
  const riskLevel: RiskLevel = share === null ? 'medium' : share < 0.4 ? 'low' : share < 0.7 ? 'medium' : 'high'
  return {
    monthly: summary.monthly_payment,
    overpayment: summary.overpayment,
    total: summary.total_payment,
    overpaymentShare: amount > 0 ? summary.overpayment / amount : 0,
    avgFcf,
    avgInflow,
    annualInflow,
    share,
    shareAfterDrop,
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
  const metrics = computeMetrics(amount, term, rate, insights)
  const items: CheckItem[] = []

  if (insights && insights.pre_approved_limit > 0 && amount > insights.pre_approved_limit) {
    const target = clamp(floor50k(insights.pre_approved_limit), product.min_amount, product.max_amount)
    items.push({
      id: 'limit',
      level: 'warn',
      text: `Сумма выше предварительного лимита ${formatMoneyShort(insights.pre_approved_limit)}`,
      hint: 'Лимит посчитан по оборотам счёта. Скорее всего, банк предложит меньшую сумму или попросит обеспечение.',
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

  const avgFcf = metrics.avgFcf
  if (avgFcf !== null && metrics.share !== null && metrics.share > 0.5) {
    const bad = metrics.share > 0.8
    const fitTerm = avgFcf > 0 ? termFor(amount, rate, product, term, (payment) => payment <= avgFcf * 0.5) : null
    const capAmount = avgFcf > 0 ? floor50k(maxAmountForPayment(avgFcf * 0.5, term, rate)) : 0
    const fix: CheckFix | undefined = fitTerm
      ? { label: `Увеличить срок до ${fitTerm} мес.`, term: fitTerm }
      : capAmount >= product.min_amount && capAmount < amount
        ? { label: `Уменьшить сумму до ${formatMoneyShort(capAmount)}`, amount: capAmount }
        : undefined
    items.push({
      id: 'load',
      level: bad ? 'bad' : 'warn',
      text: bad
        ? `Платёж больше 80% свободного потока (${formatMoneyShort(avgFcf)} в мес.)`
        : `Платёж больше половины свободного потока (${formatMoneyShort(avgFcf)} в мес.)`,
      hint: bad
        ? 'Почти все свободные деньги будут уходить на кредит — любой спад выручки приведёт к просрочке.'
        : 'На непредвиденные расходы останется немного — держите резерв хотя бы на 2–3 платежа.',
      fix,
    })
  }

  if (metrics.annualInflow !== null && amount > metrics.annualInflow * 0.5) {
    const target = clamp(floor50k(metrics.annualInflow * 0.5), product.min_amount, product.max_amount)
    items.push({
      id: 'revenue',
      level: 'warn',
      text: 'Сумма больше половины годовых поступлений на счёт',
      hint: 'Для бизнеса такого оборота это крупный долг — банк проверит его особенно внимательно.',
      fix: target < amount ? { label: `Уменьшить до ${formatMoneyShort(target)}`, amount: target } : undefined,
    })
  }

  if (metrics.fcf.length && metrics.badMonths.length > 3 && !items.some((item) => item.id === 'load' && item.fix?.term)) {
    const values = metrics.fcf.map((month) => month.value)
    const fitTerm = termFor(amount, rate, product, term, (payment) => values.filter((value) => value < payment).length <= 3)
    items.push({
      id: 'months',
      level: 'warn',
      text: `Платёж не покрывается потоком в ${metrics.badMonths.length} мес. из ${metrics.fcf.length}`,
      hint: 'В эти месяцы платить придётся из резервов или других доходов.',
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
  if (!insights) return clamp(round50k(fallback), product.min_amount, product.max_amount)
  const comfortable = insights.avg_free_cash_flow > 0
    ? maxAmountForPayment(insights.avg_free_cash_flow * 0.4, defaultTerm(product), product.base_rate)
    : fallback
  const limit = insights.pre_approved_limit > 0 ? insights.pre_approved_limit : comfortable
  return clamp(floor50k(Math.min(limit, comfortable)), product.min_amount, product.max_amount)
}

export function defaultTerm(product: Product): number {
  const preferred = product.max_term <= 12 ? product.max_term : product.max_term <= 36 ? 24 : 36
  return clamp(preferred, product.min_term, product.max_term)
}

import type { ActiveLoan, CompanyInsights, Financials, TurnoverMonth } from '@/api/types'
import { buildSchedule, maxAmountForPayment } from '@/shared/lib/annuity'
import type { MockCompany, MockDb } from './db'
import { roundTo } from './utils'

export function avgFreeCashFlow(turnover: TurnoverMonth[]): number {
  if (!turnover.length) return 0
  const total = turnover.reduce((sum, month) => sum + month.inflow - month.outflow, 0)
  return Math.round(total / turnover.length)
}

export function preApprovedLimit(mc: MockCompany): number {
  if (mc.key === 'client4') return 0
  const fcf = avgFreeCashFlow(mc.turnover)
  if (fcf <= 0) return 0
  return Math.max(0, roundTo(maxAmountForPayment(fcf * 0.6, 24, 19.5), 50_000))
}

export function companyLoans(db: MockDb, mc: MockCompany, now: number): ActiveLoan[] {
  const own: ActiveLoan[] = []
  for (const record of db.applications) {
    if (record.company_id !== mc.company.id || record.app.status !== 'DISBURSED' || !record.disbursed_at) continue
    const rate = record.app.offer?.rate ?? record.app.product.base_rate
    const schedule = buildSchedule(record.app.amount, record.app.term, rate, new Date(record.disbursed_at))
    const upcoming = schedule.find((row) => new Date(row.date).getTime() > now)
    if (!upcoming) continue
    const paidRows = schedule.filter((row) => new Date(row.date).getTime() <= now)
    const balance = paidRows.length ? paidRows[paidRows.length - 1].balance : record.app.amount
    own.push({
      id: record.app.id,
      contract_number: record.app.contract?.number ?? record.app.number,
      product_name: record.app.product.name,
      amount: record.app.amount,
      balance,
      rate,
      monthly_payment: record.app.offer?.monthly_payment ?? upcoming.amount,
      next_payment_date: upcoming.date,
      issued_at: record.disbursed_at,
      maturity_date: schedule[schedule.length - 1].date,
    })
  }
  return [...mc.external_loans, ...own]
}

export function companyInsights(db: MockDb, mc: MockCompany, now: number): CompanyInsights {
  return {
    turnover: mc.turnover,
    avg_free_cash_flow: avgFreeCashFlow(mc.turnover),
    pre_approved_limit: preApprovedLimit(mc),
    loans: companyLoans(db, mc, now),
  }
}

export function derivedFinancials(db: MockDb, mc: MockCompany, now: number): Financials {
  const revenue = mc.turnover.reduce((sum, month) => sum + month.inflow, 0)
  const expenses = mc.turnover.reduce((sum, month) => sum + month.outflow, 0)
  const lastThree = mc.turnover.slice(-3).map((month) => month.inflow)
  const debt = companyLoans(db, mc, now).reduce((sum, loan) => sum + loan.monthly_payment, 0)
  return {
    revenue_12m: revenue,
    revenue_last_3m: lastThree,
    expenses_12m: expenses,
    net_profit_12m: revenue - expenses,
    monthly_debt_payments: debt,
    employees_count: mc.company.employees_count,
    tax_system: mc.company.tax_system,
  }
}

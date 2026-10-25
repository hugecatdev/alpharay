import type { Payment, Repayment } from '@/api/types'

export function annuityPayment(amount: number, term: number, rate: number): number {
  if (amount <= 0 || term <= 0) return 0
  const monthly = rate / 1200
  if (monthly === 0) return amount / term
  return (amount * monthly) / (1 - Math.pow(1 + monthly, -term))
}

export interface LoanSummary {
  monthly_payment: number
  total_payment: number
  overpayment: number
}

function amortization(amount: number, term: number, rate: number) {
  const payment = Math.round(annuityPayment(amount, term, rate))
  let balance = Math.max(0, Math.round(amount))
  const rows = []
  for (let index = 1; index <= term; index += 1) {
    const interest = Math.round((balance * rate) / 1200)
    const principal = index === term ? balance : Math.min(balance, Math.max(0, payment - interest))
    balance -= principal
    rows.push({ amount: principal + interest, principal, interest, balance })
  }
  return rows
}

export function loanSummary(amount: number, term: number, rate: number): LoanSummary {
  const monthly = Math.round(annuityPayment(amount, term, rate))
  const total = amortization(amount, term, rate).reduce((sum, row) => sum + row.amount, 0)
  return { monthly_payment: monthly, total_payment: total, overpayment: Math.max(0, total - amount) }
}

export function revolvingSummary(amount: number, term: number, rate: number): LoanSummary {
  const monthly = amount > 0 ? Math.round((amount * rate) / 1200) : 0
  const overpayment = monthly * Math.max(0, term)
  return { monthly_payment: monthly, total_payment: Math.round(amount) + overpayment, overpayment }
}

export function creditSummary(repayment: Repayment, amount: number, term: number, rate: number): LoanSummary {
  return repayment === 'REVOLVING' ? revolvingSummary(amount, term, rate) : loanSummary(amount, term, rate)
}

export function maxAmountForPayment(payment: number, term: number, rate: number): number {
  const monthly = rate / 1200
  if (monthly === 0) return payment * term
  return (payment * (1 - Math.pow(1 + monthly, -term))) / monthly
}

export function buildSchedule(amount: number, term: number, rate: number, start: Date = new Date()): Payment[] {
  return amortization(amount, term, rate).map((row, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index + 1, Math.min(start.getDate(), 28))
    return { date: date.toISOString(), ...row }
  })
}

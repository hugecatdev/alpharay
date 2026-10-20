import type { Payment } from '@/api/types'

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

export function loanSummary(amount: number, term: number, rate: number): LoanSummary {
  const monthly = Math.round(annuityPayment(amount, term, rate))
  const total = monthly * term
  return { monthly_payment: monthly, total_payment: total, overpayment: Math.max(0, total - amount) }
}

export function maxAmountForPayment(payment: number, term: number, rate: number): number {
  const monthly = rate / 1200
  if (monthly === 0) return payment * term
  return (payment * (1 - Math.pow(1 + monthly, -term))) / monthly
}

export function buildSchedule(amount: number, term: number, rate: number, start: Date = new Date()): Payment[] {
  const monthly = rate / 1200
  const payment = annuityPayment(amount, term, rate)
  const rows: Payment[] = []
  let balance = amount
  for (let index = 1; index <= term; index += 1) {
    const interest = balance * monthly
    const principal = index === term ? balance : payment - interest
    balance = Math.max(0, balance - principal)
    const date = new Date(start.getFullYear(), start.getMonth() + index, Math.min(start.getDate(), 28))
    rows.push({
      date: date.toISOString(),
      amount: Math.round(principal + interest),
      principal: Math.round(principal),
      interest: Math.round(interest),
      balance: Math.round(balance),
    })
  }
  return rows
}

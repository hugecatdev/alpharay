import type { ActorType, DecisionType, DocumentKind } from '@/api'

export const decisionTypeLabels: Record<DecisionType, string> = {
  APPROVED: 'Одобрено',
  COUNTER_OFFER: 'Предложение на других условиях',
  NEED_INFO: 'Запрос дополнительной информации',
  MANUAL_REVIEW: 'Передано специалисту',
  REJECTED: 'Отказ',
}

export const actorTypeLabels: Record<ActorType, string> = {
  CLIENT: 'Вы',
  SYSTEM: 'Банк',
  UNDERWRITER: 'Специалист банка',
}

export function madeByLabel(madeBy: string): string {
  if (!madeBy || madeBy === 'SYSTEM') return 'Решение принято автоматически'
  return madeBy
}

export function documentKindFor(code: string): DocumentKind {
  if (code.includes('statement')) return 'BANK_STATEMENT'
  if (code.includes('tax')) return 'TAX_RETURN'
  if (code.includes('invoice')) return 'EQUIPMENT_INVOICE'
  return 'OTHER'
}

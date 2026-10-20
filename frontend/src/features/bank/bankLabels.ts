import type { DecisionType, Grade } from '@/api'
import type { Tone } from '@/shared/lib/statusMeta'

export const decisionTypeLabels: Record<DecisionType, string> = {
  APPROVED: 'Одобрено',
  COUNTER_OFFER: 'Одобрено на других условиях',
  NEED_INFO: 'Запрошена информация',
  MANUAL_REVIEW: 'Ручное рассмотрение',
  REJECTED: 'Отказ',
}

export const recommendationLabels: Record<DecisionType, string> = {
  APPROVED: 'Одобрить',
  COUNTER_OFFER: 'Одобрить на других условиях',
  NEED_INFO: 'Запросить информацию',
  MANUAL_REVIEW: 'Рассмотреть вручную',
  REJECTED: 'Отказать',
}

export const decisionTone: Record<DecisionType, Tone> = {
  APPROVED: 'success',
  COUNTER_OFFER: 'accent',
  NEED_INFO: 'warning',
  MANUAL_REVIEW: 'info',
  REJECTED: 'danger',
}

export const gradeBarTone: Record<Grade, 'green' | 'blue' | 'amber' | 'red'> = {
  A: 'green',
  B: 'blue',
  C: 'amber',
  D: 'red',
}

export const gradeDescription: Record<Grade, string> = {
  A: 'Низкий риск',
  B: 'Умеренный риск',
  C: 'Повышенный риск',
  D: 'Высокий риск',
}

export function madeByLabel(madeBy: string): string {
  if (madeBy === 'SYSTEM') return 'Система (авторешение)'
  if (madeBy === 'UNDERWRITER') return 'Андеррайтер'
  return madeBy
}

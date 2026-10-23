import type { ApplicationStatus } from '@/api/types'

export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger' | 'accent'

export interface StatusMeta {
  title: string
  description: string
  tone: Tone
  nextAction: string | null
}

export const statusMeta: Record<ApplicationStatus, StatusMeta> = {
  DRAFT: {
    title: 'Черновик',
    description: 'Заявка ещё не отправлена. Данные сохраняются автоматически — можно вернуться в любой момент.',
    tone: 'neutral',
    nextAction: 'Продолжить заполнение',
  },
  SUBMITTED: {
    title: 'Заявка отправлена',
    description: 'Банк принял заявку и поставил её в очередь на автоматическую проверку.',
    tone: 'progress',
    nextAction: null,
  },
  VALIDATING: {
    title: 'Проверка данных',
    description: 'Проверяем полноту и корректность данных заявки.',
    tone: 'progress',
    nextAction: null,
  },
  ENRICHING: {
    title: 'Запрос данных',
    description: 'Запрашиваем ЕГРЮЛ, ФНС и бюро кредитных историй.',
    tone: 'progress',
    nextAction: null,
  },
  SCORING: {
    title: 'Оценка',
    description: 'Оцениваем финансовое состояние бизнеса и платёжную дисциплину.',
    tone: 'progress',
    nextAction: null,
  },
  DECIDING: {
    title: 'Принятие решения',
    description: 'Подбираем условия по результатам оценки.',
    tone: 'progress',
    nextAction: null,
  },
  MANUAL_REVIEW: {
    title: 'На рассмотрении у специалиста',
    description: 'Заявку изучает кредитный специалист. Обычно это занимает до 1 рабочего дня.',
    tone: 'info',
    nextAction: null,
  },
  NEED_INFO: {
    title: 'Нужна информация',
    description: 'Банку не хватает данных для решения. Дополните заявку — рассмотрение продолжится автоматически.',
    tone: 'warning',
    nextAction: 'Дополнить заявку',
  },
  COUNTER_OFFER: {
    title: 'Предложение на других условиях',
    description: 'Банк готов выдать кредит, но на других условиях. Сравните и решите, подходит ли предложение.',
    tone: 'accent',
    nextAction: 'Принять или отклонить',
  },
  APPROVED: {
    title: 'Одобрено',
    description: 'Кредит одобрен. Проверьте условия и примите их — после этого откроется договор на подпись.',
    tone: 'success',
    nextAction: 'Принять условия',
  },
  OFFER_ACCEPTED: {
    title: 'Условия приняты',
    description: 'Вы приняли условия банка. Осталось подписать кредитный договор.',
    tone: 'accent',
    nextAction: 'Перейти к подписанию',
  },
  SIGNING: {
    title: 'Подписание',
    description: 'Договор сформирован. Подпишите его квалифицированной электронной подписью руководителя.',
    tone: 'accent',
    nextAction: 'Подписать договор',
  },
  SIGNED: {
    title: 'Договор подписан',
    description: 'Ожидайте зачисления средств на расчётный счёт.',
    tone: 'success',
    nextAction: null,
  },
  DISBURSED: {
    title: 'Средства зачислены',
    description: 'Деньги на расчётном счёте. График платежей доступен ниже.',
    tone: 'success',
    nextAction: null,
  },
  REJECTED: {
    title: 'Отказ',
    description: 'Банк не может выдать кредит на запрошенных условиях. Причины указаны ниже.',
    tone: 'danger',
    nextAction: 'Подобрать другой продукт',
  },
  CLIENT_DECLINED: {
    title: 'Вы отклонили предложение',
    description: 'Заявка закрыта по вашему решению. Можно подать новую в любой момент.',
    tone: 'neutral',
    nextAction: null,
  },
  CANCELLED: {
    title: 'Отменена',
    description: 'Заявка отменена.',
    tone: 'neutral',
    nextAction: null,
  },
  EXPIRED: {
    title: 'Срок предложения истёк',
    description: 'Предложение банка не было принято вовремя. Подайте заявку повторно — условия рассчитаем заново.',
    tone: 'neutral',
    nextAction: 'Подать повторно',
  },
}

export const PROCESSING_STATUSES: ApplicationStatus[] = [
  'SUBMITTED',
  'VALIDATING',
  'ENRICHING',
  'SCORING',
  'DECIDING',
  'MANUAL_REVIEW',
]
export const ACTION_STATUSES: ApplicationStatus[] = ['NEED_INFO', 'COUNTER_OFFER', 'APPROVED', 'OFFER_ACCEPTED', 'SIGNING']
export const FINAL_STATUSES: ApplicationStatus[] = ['SIGNED', 'DISBURSED', 'REJECTED', 'CLIENT_DECLINED', 'CANCELLED', 'EXPIRED']
export const RESUBMIT_STATUSES: ApplicationStatus[] = ['REJECTED', 'CLIENT_DECLINED', 'CANCELLED', 'EXPIRED']

export type StatusGroup = 'draft' | 'processing' | 'action' | 'final'

export function statusGroup(status: ApplicationStatus): StatusGroup {
  if (status === 'DRAFT') return 'draft'
  if (PROCESSING_STATUSES.includes(status)) return 'processing'
  if (ACTION_STATUSES.includes(status)) return 'action'
  return 'final'
}

export function isProcessing(status: ApplicationStatus): boolean {
  return PROCESSING_STATUSES.includes(status)
}

export interface TimelineStage {
  key: string
  title: string
  statuses: ApplicationStatus[]
}

export const TIMELINE: TimelineStage[] = [
  {
    key: 'review',
    title: 'Рассмотрение',
    statuses: ['SUBMITTED', 'VALIDATING', 'ENRICHING', 'SCORING', 'DECIDING', 'MANUAL_REVIEW', 'NEED_INFO'],
  },
  { key: 'decision', title: 'Решение', statuses: ['COUNTER_OFFER', 'APPROVED', 'REJECTED', 'CLIENT_DECLINED', 'EXPIRED'] },
  { key: 'signing', title: 'Подписание', statuses: ['OFFER_ACCEPTED', 'SIGNING', 'SIGNED'] },
  { key: 'disbursed', title: 'Зачисление', statuses: ['DISBURSED'] },
]

export function timelineIndex(status: ApplicationStatus): number {
  return TIMELINE.findIndex((stage) => stage.statuses.includes(status))
}

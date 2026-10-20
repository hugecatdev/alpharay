import type { DocumentKind, Grade, LegalForm, NotificationType, PurposeType, TaxSystem } from '@/api/types'

export const purposeLabels: Record<PurposeType, { title: string; hint: string }> = {
  WORKING_CAPITAL: { title: 'Пополнение оборотных средств', hint: 'Закупка товара, сырья, сезонный запас' },
  CASH_GAP: { title: 'Покрытие кассовых разрывов', hint: 'Платежи поставщикам до поступления выручки' },
  EQUIPMENT: { title: 'Покупка оборудования', hint: 'Станки, техника, кухня, транспорт' },
}

export const PURPOSE_ORDER: PurposeType[] = ['CASH_GAP', 'WORKING_CAPITAL', 'EQUIPMENT']

export const taxSystemLabels: Record<TaxSystem, string> = {
  USN_6: 'УСН 6%',
  USN_15: 'УСН 15%',
  OSN: 'ОСН',
  PATENT: 'Патент',
}

export const legalFormLabels: Record<LegalForm, string> = {
  OOO: 'Общество с ограниченной ответственностью',
  IP: 'Индивидуальный предприниматель',
}

export const documentKindLabels: Record<DocumentKind, string> = {
  BANK_STATEMENT: 'Выписка по счёту',
  TAX_RETURN: 'Налоговая декларация',
  EQUIPMENT_INVOICE: 'Счёт на оборудование',
  OTHER: 'Другой документ',
}

export const notificationTypeLabels: Record<NotificationType, string> = {
  APPLICATION_SUBMITTED: 'Заявка отправлена',
  STAGE_PASSED: 'Этап пройден',
  INFO_REQUESTED: 'Запрос информации',
  DECISION_MADE: 'Решение',
  OFFER_PENDING: 'Предложение',
  OFFER_EXPIRING: 'Срок предложения',
  CONTRACT_READY: 'Договор',
  DISBURSED: 'Зачисление',
  PERSONAL_OFFER: 'Для вас',
}

export const gradeTone: Record<Grade, 'success' | 'info' | 'warning' | 'danger'> = {
  A: 'success',
  B: 'info',
  C: 'warning',
  D: 'danger',
}

export const rejectReasonOptions: { code: string; label: string }[] = [
  { code: 'OVERDUE', label: 'Просроченная задолженность' },
  { code: 'TAX_DEBT', label: 'Налоговая задолженность' },
  { code: 'LOW_REVENUE', label: 'Недостаточная выручка' },
  { code: 'HIGH_DEBT_LOAD', label: 'Высокая долговая нагрузка' },
  { code: 'STOP_FACTORS', label: 'Стоп-факторы по внешним источникам' },
  { code: 'DATA_MISMATCH', label: 'Существенное расхождение данных' },
  { code: 'OTHER', label: 'Другое' },
]

export const infoRequestOptions: { code: string; label: string; type: 'text' | 'number' | 'document' }[] = [
  { code: 'revenue_12m', label: 'Уточните выручку за 12 месяцев', type: 'number' },
  { code: 'statement_6m', label: 'Выписка по счёту за 6 месяцев', type: 'document' },
  { code: 'tax_return', label: 'Налоговая декларация за последний период', type: 'document' },
  { code: 'equipment_invoice', label: 'Счёт на оборудование', type: 'document' },
  { code: 'overdue_explanation', label: 'Пояснение по просрочке', type: 'text' },
]

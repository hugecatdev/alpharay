import type { Application } from '@/api'

export const WIZARD_STEPS = [
  { key: 'product', title: 'Продукт', heading: 'Выберите кредит' },
  { key: 'amount', title: 'Сумма и срок', heading: 'Сумма и срок' },
  { key: 'company', title: 'Компания', heading: 'Данные компании' },
  { key: 'financials', title: 'Финансы', heading: 'Финансовые показатели' },
  { key: 'documents', title: 'Документы', heading: 'Документы' },
  { key: 'review', title: 'Отправка', heading: 'Проверка и отправка' },
] as const

export type StepKey = (typeof WIZARD_STEPS)[number]['key']

export function isStepKey(value: string | null): value is StepKey {
  return WIZARD_STEPS.some((step) => step.key === value)
}

export function stepIndex(key: StepKey): number {
  return WIZARD_STEPS.findIndex((step) => step.key === key)
}

const PROGRESS_PREFIX = 'alpharay-wizard-progress-'

export function readProgress(id: string): number {
  try {
    const raw = localStorage.getItem(`${PROGRESS_PREFIX}${id}`)
    const value = raw === null ? -1 : Number(raw)
    return Number.isFinite(value) ? value : -1
  } catch {
    return -1
  }
}

export function writeProgress(id: string, completed: number): void {
  try {
    if (completed > readProgress(id)) localStorage.setItem(`${PROGRESS_PREFIX}${id}`, String(completed))
  } catch {
    return
  }
}

export function completedIndex(application: Application | null | undefined): number {
  if (!application) return -1
  let derived = 0
  if (application.company_confirmed) derived = 2
  if (application.financials) derived = Math.max(derived, 3)
  return Math.max(derived, readProgress(application.id))
}

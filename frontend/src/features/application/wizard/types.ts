import type { StepKey } from './steps'

export interface StepNav {
  next: () => void
  back: () => void
  goTo: (key: StepKey) => void
}

export interface LiveParams {
  productCode?: string
  amount?: number
  term?: number
}

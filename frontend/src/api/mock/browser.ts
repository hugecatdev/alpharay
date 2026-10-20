import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

export function createWorker() {
  return setupWorker(...handlers)
}

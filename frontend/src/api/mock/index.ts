import { loadDb, resetDb } from './db'
import { createWorker } from './browser'

export async function startMockWorker(): Promise<void> {
  loadDb()
  await createWorker().start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}

export function resetMockData(): void {
  resetDb()
}

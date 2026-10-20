import { http } from 'msw'
import type { AppConfig } from '@/api/types'
import { MANUAL_REVIEW_THRESHOLD } from '../pipeline'
import { json } from '../utils'
import { publicRoute } from './common'

export const catalogHandlers = [
  http.get(
    '/api/health',
    publicRoute(() => json({ status: 'ok' }), { delay: [20, 60] }),
  ),
  http.get(
    '/api/config',
    publicRoute(({ db }) => {
      const config: AppConfig = {
        assistant_enabled: import.meta.env.VITE_ASSISTANT_ENABLED !== 'false',
        manual_review_amount_threshold: MANUAL_REVIEW_THRESHOLD,
        products: db.products,
      }
      return json(config)
    }),
  ),
]

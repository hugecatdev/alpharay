import { applicationHandlers } from './applications'
import { assistantHandlers } from './assistant'
import { authHandlers } from './auth'
import { bankHandlers } from './bank'
import { catalogHandlers } from './catalog'
import { companyHandlers } from './company'
import { notificationHandlers } from './notifications'

export const handlers = [
  ...authHandlers,
  ...catalogHandlers,
  ...companyHandlers,
  ...applicationHandlers,
  ...notificationHandlers,
  ...assistantHandlers,
  ...bankHandlers,
]

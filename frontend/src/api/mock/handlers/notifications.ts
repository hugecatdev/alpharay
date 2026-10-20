import { http } from 'msw'
import type { AppNotification } from '@/api/types'
import type { MockNotification } from '../db'
import { apiError, json, noContent } from '../utils'
import { route } from './common'

function strip(item: MockNotification): AppNotification {
  return {
    id: item.id,
    application_id: item.application_id,
    type: item.type,
    title: item.title,
    body: item.body,
    is_read: item.is_read,
    created_at: item.created_at,
  }
}

export const notificationHandlers = [
  http.get(
    '/api/notifications',
    route(({ db, user, url }) => {
      const unread = url.searchParams.get('unread') === 'true'
      const limit = Number(url.searchParams.get('limit') ?? 0)
      let list = db.notifications
        .filter((item) => item.user_id === user.id && (!unread || !item.is_read))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
      if (limit > 0) list = list.slice(0, limit)
      return json(list.map(strip))
    }),
  ),
  http.post(
    '/api/notifications/read-all',
    route(({ db, user }) => {
      for (const item of db.notifications) if (item.user_id === user.id) item.is_read = true
      return noContent()
    }),
  ),
  http.post(
    '/api/notifications/:id/read',
    route(({ db, user, params }) => {
      const item = db.notifications.find((notification) => notification.id === params.id && notification.user_id === user.id)
      if (!item) return apiError(404, 'NOT_FOUND', 'Уведомление не найдено')
      item.is_read = true
      return noContent()
    }),
  ),
]

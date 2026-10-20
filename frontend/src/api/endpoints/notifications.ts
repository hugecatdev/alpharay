import { request } from '../client'
import type { AppNotification } from '../types'

export const notificationsApi = {
  list: (params: { unread?: boolean; limit?: number } = {}) =>
    request<AppNotification[]>('/notifications', { query: { unread: params.unread, limit: params.limit } }),
  read: (id: string) => request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  readAll: () => request<void>('/notifications/read-all', { method: 'POST' }),
}

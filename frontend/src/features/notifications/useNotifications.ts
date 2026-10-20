import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { notificationsApi, queryKeys } from '@/api'

export function useUnreadNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notificationsList(true),
    queryFn: () => notificationsApi.list({ unread: true }),
    refetchInterval: 10_000,
    enabled,
  })
}

export function useNotificationsList(limit?: number) {
  return useQuery({
    queryKey: [...queryKeys.notificationsList(false), limit ?? 'all'],
    queryFn: () => notificationsApi.list({ unread: false, limit }),
    refetchInterval: 10_000,
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => notificationsApi.read(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => notificationsApi.readAll(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  })
}

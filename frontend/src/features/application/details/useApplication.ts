import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { applicationsApi, queryKeys, type Application, type ApplicationStatus } from '@/api'
import { isProcessing } from '@/shared/lib/statusMeta'

export function shouldPoll(status: ApplicationStatus | undefined): boolean {
  return status !== undefined && (isProcessing(status) || status === 'SIGNED')
}

export function useApplication(id: string, options: { interval?: number } = {}) {
  const queryClient = useQueryClient()
  const interval = options.interval ?? 2000
  const query = useQuery({
    queryKey: queryKeys.application(id),
    queryFn: () => applicationsApi.get(id),
    enabled: Boolean(id),
    refetchInterval: (current) => (shouldPoll(current.state.data?.status) ? interval : false),
  })

  const status = query.data?.status
  const previous = useRef<ApplicationStatus | undefined>(status)
  useEffect(() => {
    if (status && previous.current && previous.current !== status) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications, exact: true })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
      void queryClient.invalidateQueries({ queryKey: queryKeys.events(id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.insights })
    }
    previous.current = status
  }, [status, id, queryClient])

  return query
}

export function useApplicationEvents(id: string, poll: boolean) {
  return useQuery({
    queryKey: queryKeys.events(id),
    queryFn: () => applicationsApi.events(id),
    enabled: Boolean(id),
    refetchInterval: poll ? 2000 : false,
  })
}

export function useApplicationCache(id: string) {
  const queryClient = useQueryClient()
  return (application: Application) => {
    queryClient.setQueryData(queryKeys.application(id), application)
    void queryClient.invalidateQueries({ queryKey: queryKeys.applications, exact: true })
    void queryClient.invalidateQueries({ queryKey: queryKeys.events(id) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
  }
}

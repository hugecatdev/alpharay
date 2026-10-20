import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bankApi, queryKeys, type ApplicationStatus, type BankDecisionRequest } from '@/api'
import { isProcessing } from '@/shared/lib/statusMeta'

export type QueueStatusFilter = ApplicationStatus | 'ALL'
export type AssignedFilter = 'any' | 'me'

export function useBankQueue(status: QueueStatusFilter, assigned: AssignedFilter) {
  return useQuery({
    queryKey: queryKeys.bankQueue(status, assigned),
    queryFn: () => bankApi.list({ status, assigned }),
    refetchInterval: 5000,
  })
}

export function useBankApplication(id: string) {
  return useQuery({
    queryKey: queryKeys.bankApplication(id),
    queryFn: () => bankApi.get(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && isProcessing(status) ? 5000 : false
    },
  })
}

export function useBankEvents(id: string, status: ApplicationStatus | undefined) {
  return useQuery({
    queryKey: [...queryKeys.bankEvents(id), status ?? ''],
    queryFn: () => bankApi.events(id),
    enabled: !!status,
  })
}

export function useBankStats() {
  return useQuery({ queryKey: queryKeys.bankStats, queryFn: bankApi.stats, refetchInterval: 10_000 })
}

export function useAssign() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => bankApi.assign(id),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.bankApplication(data.id), data)
      void queryClient.invalidateQueries({ queryKey: ['bank'] })
    },
  })
}

export function useDecision(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: BankDecisionRequest) => bankApi.decide(id, body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.bankApplication(id), data)
      void queryClient.invalidateQueries({ queryKey: ['bank'] })
    },
  })
}

export function isAssignedToMe(assignedTo: string | null, user: { id: string; full_name: string; email: string }): boolean {
  if (!assignedTo) return false
  return assignedTo === user.id || assignedTo === user.full_name || assignedTo === user.email
}

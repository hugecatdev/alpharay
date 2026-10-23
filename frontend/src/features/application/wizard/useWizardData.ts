import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, applicationsApi, companyApi, queryKeys, type Application, type PatchApplicationRequest } from '@/api'

export function useApplicationQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.application(id ?? 'new'),
    queryFn: () => applicationsApi.get(id ?? ''),
    enabled: Boolean(id),
  })
}

export function useInsights() {
  return useQuery({ queryKey: queryKeys.insights, queryFn: companyApi.insights, staleTime: 5 * 60 * 1000, retry: 1 })
}

export function useCompany() {
  return useQuery({ queryKey: queryKeys.company, queryFn: companyApi.get, staleTime: 5 * 60 * 1000 })
}

export function usePatchApplication(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PatchApplicationRequest) =>
      applicationsApi.patch(id, body, queryClient.getQueryData<Application>(queryKeys.application(id))?.version),
    onSuccess: (application: Application) => {
      queryClient.setQueryData(queryKeys.application(id), application)
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications, exact: true })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.application(id) })
      }
    },
  })
}

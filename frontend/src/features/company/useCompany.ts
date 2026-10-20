import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, companyApi, queryKeys } from '@/api'

export function isNoCompanyError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NO_COMPANY'
}

export function useCompany() {
  const query = useQuery({ queryKey: queryKeys.company, queryFn: companyApi.get })
  return { ...query, missing: isNoCompanyError(query.error) }
}

export function useLinkCompany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (inn: string) => companyApi.link(inn),
    onSuccess: (company) => {
      queryClient.setQueryData(queryKeys.company, company)
      void queryClient.invalidateQueries()
    },
  })
}

import { useQuery } from '@tanstack/react-query'
import { configApi, queryKeys, type AppConfig, type Product } from '@/api'

export function useConfig() {
  return useQuery({ queryKey: queryKeys.config, queryFn: configApi.get, staleTime: 5 * 60 * 1000 })
}

export function useAssistantEnabled(): boolean {
  const { data } = useConfig()
  return data?.assistant_enabled ?? false
}

export function useProducts(): Product[] {
  const { data } = useConfig()
  return data?.products ?? []
}

export function findProduct(config: AppConfig | undefined, code: string | null | undefined): Product | undefined {
  return config?.products.find((product) => product.code === code)
}

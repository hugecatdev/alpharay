import type { ReactNode } from 'react'
import { PageHeader, PageLoader } from '@/shared/ui'
import { CompanyOnboarding } from './CompanyOnboarding'
import { useCompany } from './useCompany'

interface CompanyGateProps {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}

export function CompanyGate({ eyebrow, title, description, children }: CompanyGateProps) {
  const company = useCompany()
  if (company.isPending) return <PageLoader />
  if (!company.missing) return <>{children}</>
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      <CompanyOnboarding />
    </>
  )
}

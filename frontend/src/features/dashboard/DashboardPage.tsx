import { useQuery } from '@tanstack/react-query'
import { applicationsApi, companyApi, queryKeys } from '@/api'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { CompanyGate } from '@/features/company/CompanyGate'
import { statusGroup } from '@/shared/lib/statusMeta'
import { ErrorState } from '@/shared/ui'
import { ApplicationsCard } from './ApplicationsCard'
import { CompanyHero, FinancingCta } from './CompanyHero'
import { DebtLoadCard } from './DebtLoadCard'
import { NotificationsCard } from './NotificationsCard'
import { TurnoverCard } from './TurnoverCard'
import styles from './Dashboard.module.css'

function firstName(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean)
  return (parts.length === 3 ? parts[1] : parts[0]) ?? ''
}

export function DashboardPage() {
  const user = useCurrentUser()
  return (
    <CompanyGate
      eyebrow="Личный кабинет"
      title={`Здравствуйте, ${firstName(user.full_name)}`}
      description="Начнём с компании: по ИНН подставим реквизиты, и можно будет подать заявку."
    >
      <DashboardContent />
    </CompanyGate>
  )
}

function DashboardContent() {
  const user = useCurrentUser()
  const company = useQuery({ queryKey: queryKeys.company, queryFn: companyApi.get })
  const insights = useQuery({ queryKey: queryKeys.insights, queryFn: companyApi.insights })
  const applications = useQuery({ queryKey: queryKeys.applications, queryFn: applicationsApi.list, refetchInterval: 10_000 })

  const loans = insights.data?.loans ?? []
  const apps = applications.data ?? []
  const totalDebt = loans.reduce((sum, loan) => sum + loan.balance, 0)
  const activeApplications = apps.filter((application) => statusGroup(application.status) !== 'final').length

  useAssistantScreen({
    screen: 'dashboard',
    title: 'Главная',
    data: {
      company_name: company.data?.name ?? null,
      active_applications: activeApplications,
      loans_count: loans.length,
      total_debt: totalDebt,
      avg_free_cash_flow: insights.data?.avg_free_cash_flow ?? null,
      pre_approved_limit: insights.data?.pre_approved_limit ?? null,
    },
    suggestions: ['Какой продукт мне подходит?', 'Сколько я могу взять без риска?', 'Что означает свободный денежный поток?'],
  })

  if (company.isError) return <ErrorState error={company.error} onRetry={() => void company.refetch()} />

  return (
    <div className={styles.page}>
      <CompanyHero user={user} company={company.data} />
      <FinancingCta limit={insights.data?.pre_approved_limit ?? 0} loading={insights.isLoading} />

      <section className={styles.mainRow}>
        <ApplicationsCard applications={apps} loading={applications.isLoading} />
        <DebtLoadCard insights={insights.data} loading={insights.isLoading} />
      </section>

      <TurnoverCard insights={insights.data} loading={insights.isLoading} />

      <NotificationsCard />
    </div>
  )
}

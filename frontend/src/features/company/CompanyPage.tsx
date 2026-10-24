import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Landmark, ShieldCheck } from 'lucide-react'
import { applicationsApi, companyApi, queryKeys, type ApplicationShort } from '@/api'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { AskButton } from '@/features/assistant/AskButton'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { formatBusinessAge, formatDate, formatTerm, formatUpdated, plural } from '@/shared/lib/dates'
import { legalFormLabels, taxSystemLabels } from '@/shared/lib/labels'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { Badge, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Skeleton, StatusBadge, StatusTile } from '@/shared/ui'
import styles from './CompanyPage.module.css'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function applicationLink(application: ApplicationShort): string {
  return application.status === 'DRAFT'
    ? `/app/applications/${application.id}/edit`
    : `/app/applications/${application.id}`
}

export function CompanyPage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const company = useQuery({ queryKey: queryKeys.company, queryFn: companyApi.get })
  const insights = useQuery({ queryKey: queryKeys.insights, queryFn: companyApi.insights })
  const applications = useQuery({ queryKey: queryKeys.applications, queryFn: applicationsApi.list })

  const loans = insights.data?.loans ?? []
  const apps = applications.data ?? []
  const totalDebt = loans.reduce((sum, loan) => sum + loan.balance, 0)

  useAssistantScreen({
    screen: 'company',
    title: 'Профиль компании',
    data: {
      company_name: company.data?.name ?? null,
      inn: company.data?.inn ?? null,
      okved: company.data ? `${company.data.okved_main} ${company.data.okved_name}` : null,
      tax_system: company.data ? taxSystemLabels[company.data.tax_system] : null,
      loans_count: loans.length,
      total_debt: totalDebt,
      applications_count: apps.length,
    },
    suggestions: ['Откуда взяты данные компании?', 'Что делать, если данные неверны?', 'Как банк смотрит на мою долговую нагрузку?'],
  })

  if (company.isError) return <ErrorState error={company.error} onRetry={() => void company.refetch()} />

  const data = company.data

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Профиль компании"
        title={data?.name ?? 'Компания'}
        description={data ? `${legalFormLabels[data.legal_form]} · данные из ЕГРЮЛ, вводить их повторно не нужно` : undefined}
        status={
          data ? (
            <Badge tone="success" dot>
              Подтверждено
            </Badge>
          ) : undefined
        }
      />

      {data ? (
        <section className={styles.hero} data-assist="company-profile">
          <div className={styles.person}>
            <span className={styles.avatar} aria-hidden>
              {initials(user.full_name)}
            </span>
            <div className={styles.personText}>
              <strong>{user.full_name}</strong>
              <span>{user.position}</span>
            </div>
          </div>
          <dl className={styles.figures}>
            <div>
              <dt>ИНН</dt>
              <dd className="tabular">{data.inn}</dd>
            </div>
            <div>
              <dt>Возраст бизнеса</dt>
              <dd>{formatBusinessAge(data.registration_date)}</dd>
            </div>
            <div>
              <dt>Налоги</dt>
              <dd>{taxSystemLabels[data.tax_system]}</dd>
            </div>
            <div>
              <dt>Сотрудников по ФНС</dt>
              <dd className="tabular">{data.employees_count}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <div className={styles.skeletons}>
          <Skeleton height={64} width={64} radius={32} />
          <Skeleton height={22} width="50%" />
        </div>
      )}

      <Card
        title="Реквизиты"
        eyebrow="По данным ЕГРЮЛ"
        actions={<AskButton question="Откуда взяты данные компании и что делать, если они неверны?" />}
      >
        {data ? (
          <dl className={styles.facts}>
            <div>
              <dt>ОГРН</dt>
              <dd className="tabular">{data.ogrn}</dd>
            </div>
            <div>
              <dt>Дата регистрации</dt>
              <dd className="tabular">{formatDate(data.registration_date)}</dd>
            </div>
            <div>
              <dt>Руководитель</dt>
              <dd>{data.head_name}</dd>
            </div>
            <div className={styles.wide}>
              <dt>Основной ОКВЭД</dt>
              <dd>
                {data.okved_main} — {data.okved_name}
              </dd>
            </div>
            <div className={styles.wide}>
              <dt>Юридический адрес</dt>
              <dd>{data.address}</dd>
            </div>
          </dl>
        ) : (
          <Skeleton height={120} />
        )}
        <p className={styles.note}>
          <ShieldCheck size={16} aria-hidden />
          Изменить реквизиты можно только через регистрирующий орган — после обновления ЕГРЮЛ они обновятся здесь автоматически.
        </p>
      </Card>

      <Card
        title="Кредиты"
        eyebrow="Действующие и заявки"
        assist="company-loans"
        actions={<AskButton question="Как банк оценивает мою текущую долговую нагрузку?" />}
      >
        {insights.isLoading || applications.isLoading ? (
          <Skeleton height={140} />
        ) : loans.length === 0 && apps.length === 0 ? (
          <EmptyState icon={<Landmark size={22} />} title="Кредитов и заявок пока нет">
            Когда вы оформите первую заявку, она появится здесь.
          </EmptyState>
        ) : (
          <>
            <div className={styles.debt}>
              <span>Остаток долга</span>
              <strong className="tabular">{loans.length ? formatMoney(totalDebt) : 'Нет долга'}</strong>
              <span>
                {loans.length} {plural(loans.length, 'действующий кредит', 'действующих кредита', 'действующих кредитов')} ·{' '}
                {apps.length} {plural(apps.length, 'заявка', 'заявки', 'заявок')}
              </span>
            </div>
            <ul className={styles.rows}>
              {loans.map((loan) => {
                const repaid = loan.amount - loan.balance
                return (
                  <li key={loan.id} className={styles.row}>
                    <span className={styles.loanTile} aria-hidden>
                      <Landmark size={20} />
                    </span>
                    <span className={styles.rowMain}>
                      <strong>{loan.product_name}</strong>
                      <span className="tabular">
                        Договор {loan.contract_number} · {formatRate(loan.rate)} · до {formatDate(loan.maturity_date)}
                      </span>
                    </span>
                    <span className={styles.rowSide}>
                      <span className="tabular">
                        Остаток <b>{formatMoney(loan.balance)}</b>
                      </span>
                      <ProgressBar value={repaid} max={loan.amount} tone="lime" height={4} label="Погашено" />
                    </span>
                  </li>
                )
              })}
              {apps.map((application) => (
                <li key={application.id}>
                  <button type="button" className={styles.row} onClick={() => navigate(applicationLink(application))}>
                    <StatusTile status={application.status} productCode={application.product_code} />
                    <span className={styles.rowMain}>
                      <strong>{application.product_name}</strong>
                      <span className="tabular">
                        № {application.number} · {formatMoney(application.amount)} · {formatTerm(application.term)}
                      </span>
                    </span>
                    <span className={styles.rowSide}>
                      <StatusBadge status={application.status} />
                      <span className={styles.rowDate}>{formatUpdated(application.updated_at)}</span>
                    </span>
                    <ChevronRight size={18} className={styles.chevron} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  )
}

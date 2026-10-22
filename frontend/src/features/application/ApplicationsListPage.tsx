import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, FilePlus2, Files } from 'lucide-react'
import { applicationsApi, queryKeys, type ApplicationShort } from '@/api'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { cn } from '@/shared/lib/cn'
import { formatTerm, formatUpdated } from '@/shared/lib/dates'
import { formatMoney } from '@/shared/lib/money'
import { isProcessing, statusGroup, statusMeta, type StatusGroup } from '@/shared/lib/statusMeta'
import { ButtonLink, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, StatusTile, Tabs } from '@/shared/ui'
import styles from './ApplicationsListPage.module.css'

type Filter = 'all' | StatusGroup

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'action', label: 'Требуют действия' },
  { value: 'processing', label: 'В работе' },
  { value: 'draft', label: 'Черновики' },
  { value: 'final', label: 'Завершённые' },
]

const EMPTY_TEXT: Record<Filter, string> = {
  all: 'Подберите продукт и заполните заявку — это займёт несколько минут, данные компании уже подтянуты.',
  action: 'Сейчас ни одна заявка не ждёт вашего решения.',
  processing: 'Нет заявок на рассмотрении.',
  draft: 'Черновиков нет.',
  final: 'Завершённых заявок пока нет.',
}

function linkFor(application: ApplicationShort): string {
  return application.status === 'DRAFT'
    ? `/app/applications/${application.id}/edit?step=amount`
    : `/app/applications/${application.id}`
}

function ApplicationRow({ application }: { application: ApplicationShort }) {
  const group = statusGroup(application.status)
  const next = statusMeta[application.status].nextAction
  return (
    <li>
      <Link to={linkFor(application)} className={cn(styles.row, group === 'action' && styles.rowAction)}>
        <StatusTile status={application.status} productCode={application.product_code} />
        <span className={styles.main}>
          <span className={styles.number}>{application.number}</span>
          <strong className={styles.product}>{application.product_name}</strong>
          {group === 'action' && next && <span className={styles.next}>{next}</span>}
        </span>
        <span className={styles.money}>
          <strong className="tabular">{formatMoney(application.amount)}</strong>
          <span>{formatTerm(application.term)}</span>
        </span>
        <span className={styles.status}>
          <StatusBadge status={application.status} />
          <span className={styles.updated}>{formatUpdated(application.updated_at)}</span>
        </span>
        <ChevronRight size={18} className={styles.chevron} aria-hidden />
      </Link>
    </li>
  )
}

export function ApplicationsListPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const query = useQuery({
    queryKey: queryKeys.applications,
    queryFn: applicationsApi.list,
    refetchInterval: (current) => (current.state.data?.some((item) => isProcessing(item.status)) ? 5000 : false),
  })

  const sorted = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [query.data],
  )

  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: sorted.length, action: 0, processing: 0, draft: 0, final: 0 }
    for (const item of sorted) result[statusGroup(item.status)] += 1
    return result
  }, [sorted])

  const visible = filter === 'all' ? sorted : sorted.filter((item) => statusGroup(item.status) === filter)

  useAssistantScreen({
    screen: 'applications',
    title: 'Мои заявки',
    data: {
      total: counts.all,
      action_required: counts.action,
      processing: counts.processing,
      drafts: counts.draft,
    },
    suggestions: ['Что означает мой статус?', 'Какой продукт мне подходит?', 'Сколько будет платёж?'],
  })

  return (
    <div>
      <PageHeader
        eyebrow="Заявки"
        title="Мои заявки"
        description="Все обращения за финансированием и их статус — в одном месте."
        actions={
          <ButtonLink to="/app/applications/new" icon={<FilePlus2 size={17} />}>
            Новая заявка
          </ButtonLink>
        }
      />

      <div className={styles.toolbar}>
        <Tabs
          value={filter}
          onChange={setFilter}
          items={FILTERS.map((item) => ({ ...item, count: query.data ? counts[item.value] : undefined }))}
        />
      </div>

      <div data-assist="applications">
        {query.isPending ? (
          <div className={styles.skeletons}>
            <Skeleton height={76} radius={14} />
            <Skeleton height={76} radius={14} />
            <Skeleton height={76} radius={14} />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : visible.length === 0 ? (
          <div className={styles.empty}>
            <EmptyState
              icon={<Files size={22} />}
              title={filter === 'all' ? 'Заявок пока нет' : 'Здесь пусто'}
              action={
                filter === 'all' || filter === 'draft' ? (
                  <ButtonLink to="/app/applications/new" icon={<FilePlus2 size={16} />}>
                    Оформить заявку
                  </ButtonLink>
                ) : undefined
              }
            >
              {EMPTY_TEXT[filter]}
            </EmptyState>
          </div>
        ) : (
          <ul className={styles.list}>
            {visible.map((application) => (
              <ApplicationRow key={application.id} application={application} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

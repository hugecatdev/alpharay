import { ArrowUpRight, ChevronRight, FilePlus2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ApplicationShort } from '@/api'
import { formatRelative, formatTerm } from '@/shared/lib/dates'
import { formatMoney } from '@/shared/lib/money'
import { statusGroup, type StatusGroup } from '@/shared/lib/statusMeta'
import { ButtonLink, Card, EmptyState, Skeleton, StatusBadge, StatusTile } from '@/shared/ui'
import styles from './Dashboard.module.css'

const GROUP_ORDER: Record<StatusGroup, number> = { action: 0, processing: 1, draft: 2, final: 3 }

function linkFor(application: ApplicationShort): string {
  return application.status === 'DRAFT'
    ? `/app/applications/${application.id}/edit`
    : `/app/applications/${application.id}`
}

export function ApplicationsCard({ applications, loading }: { applications: ApplicationShort[]; loading: boolean }) {
  const sorted = [...applications].sort((a, b) => {
    const group = GROUP_ORDER[statusGroup(a.status)] - GROUP_ORDER[statusGroup(b.status)]
    if (group !== 0) return group
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })
  const visible = sorted.slice(0, 5)

  return (
    <Card
      title="Активные заявки"
      eyebrow="Кредитный конвейер"
      assist="applications"
      className={styles.listCard}
      actions={
        <Link to="/app/applications" className={styles.moreLink}>
          Все заявки <ArrowUpRight size={15} strokeWidth={2.4} aria-hidden />
        </Link>
      }
    >
      {loading ? (
        <div className={styles.stack}>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} height={58} radius={12} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FilePlus2 size={22} />}
          title="Заявок пока нет"
          action={
            <ButtonLink to="/app/applications/new" variant="secondary" size="sm">
              Оформить заявку
            </ButtonLink>
          }
        >
          Подберите продукт — черновик сохранится автоматически.
        </EmptyState>
      ) : (
        <ul className={styles.rows}>
          {visible.map((application) => {
            const needsAction = statusGroup(application.status) === 'action'
            return (
              <li key={application.id}>
                <Link to={linkFor(application)} className={styles.row} data-action={needsAction || undefined}>
                  <StatusTile status={application.status} productCode={application.product_code} />
                  <span className={styles.rowMain}>
                    <strong>{application.product_name}</strong>
                    <span className="tabular">
                      № {application.number} · {formatMoney(application.amount)} · {formatTerm(application.term)}
                    </span>
                  </span>
                  <span className={styles.rowSide}>
                    <StatusBadge status={application.status} />
                    <span className={styles.rowDate}>{formatRelative(application.updated_at)}</span>
                  </span>
                  <ChevronRight size={18} className={styles.rowChevron} aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

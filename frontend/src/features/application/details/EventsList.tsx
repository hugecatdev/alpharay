import type { AppEvent } from '@/api'
import { cn } from '@/shared/lib/cn'
import { formatDateTime } from '@/shared/lib/dates'
import { statusMeta } from '@/shared/lib/statusMeta'
import { Card, EmptyState, Skeleton } from '@/shared/ui'
import { actorTypeLabels } from './format'
import styles from './EventsList.module.css'

function eventTitle(event: AppEvent): string {
  if (event.to_status === 'DRAFT') return 'Черновик создан'
  if (event.from_status === event.to_status) return event.reason ?? statusMeta[event.to_status].title
  return statusMeta[event.to_status].title
}

export function EventsList({ events, loading }: { events: AppEvent[] | undefined; loading: boolean }) {
  const sorted = [...(events ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <Card title="История" assist="events">
      {loading && !events ? (
        <div className={styles.loading}>
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState title="Событий пока нет" />
      ) : (
        <ol className={styles.list}>
          {sorted.map((event, index) => {
            const tone = statusMeta[event.to_status].tone
            const title = eventTitle(event)
            const showReason = event.reason && event.reason !== title
            return (
              <li key={event.id} className={cn(styles.item, index === 0 && styles.latest, styles[tone])}>
                <span className={styles.dot} aria-hidden />
                <div className={styles.body}>
                  <div className={styles.head}>
                    <strong>{title}</strong>
                    <time dateTime={event.created_at}>{formatDateTime(event.created_at)}</time>
                  </div>
                  {showReason && <p className={styles.reason}>{event.reason}</p>}
                  <span className={styles.actor}>
                    {actorTypeLabels[event.actor_type]}
                    {event.actor_name && event.actor_type !== 'CLIENT' ? ` · ${event.actor_name}` : ''}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}

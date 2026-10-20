import { ArrowUpRight, BellOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { AppNotification } from '@/api'
import { notificationMeta } from '@/features/notifications/notificationMeta'
import { useMarkNotificationRead, useNotificationsList } from '@/features/notifications/useNotifications'
import { cn } from '@/shared/lib/cn'
import { formatRelative } from '@/shared/lib/dates'
import { Card, EmptyState, Skeleton } from '@/shared/ui'
import styles from './Dashboard.module.css'

export function NotificationsCard() {
  const navigate = useNavigate()
  const list = useNotificationsList(10)
  const markRead = useMarkNotificationRead()
  const items = list.data ?? []

  function open(item: AppNotification) {
    if (!item.is_read) markRead.mutate(item.id)
    if (item.application_id) navigate(`/app/applications/${item.application_id}`)
  }

  return (
    <Card
      title="Уведомления"
      eyebrow="Последние события"
      className={styles.listCard}
      actions={
        <Link to="/app/notifications" className={styles.moreLink}>
          Все <ArrowUpRight size={15} strokeWidth={2.4} aria-hidden />
        </Link>
      }
    >
      {list.isLoading ? (
        <div className={styles.stack}>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} height={48} radius={12} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<BellOff size={22} />} title="Пока тихо">
          События по заявкам будут появляться здесь.
        </EmptyState>
      ) : (
        <ul className={styles.notes}>
          {items.map((item) => {
            const meta = notificationMeta[item.type]
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(styles.note, !item.is_read && styles.noteUnread, styles[`tone-${meta.tone}`])}
                  onClick={() => open(item)}
                >
                  <span className={styles.noteIcon} aria-hidden>
                    {meta.icon}
                  </span>
                  <span className={styles.noteText}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </span>
                  <span className={styles.noteTime}>{formatRelative(item.created_at)}</span>
                  {!item.is_read && <i className={styles.noteDot} aria-label="Не прочитано" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

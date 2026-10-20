import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, CheckCheck, ChevronRight } from 'lucide-react'
import type { AppNotification } from '@/api'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { cn } from '@/shared/lib/cn'
import { formatDate, formatTime } from '@/shared/lib/dates'
import { notificationTypeLabels } from '@/shared/lib/labels'
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '@/shared/ui'
import { notificationMeta } from './notificationMeta'
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationsList } from './useNotifications'
import styles from './NotificationsPage.module.css'

type Filter = 'all' | 'unread'

function dayLabel(value: string, now: Date): string {
  const date = new Date(value)
  if (date.toDateString() === now.toDateString()) return 'Сегодня'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера'
  return formatDate(date)
}

function groupByDay(items: AppNotification[]): { label: string; items: AppNotification[] }[] {
  const now = new Date()
  const sorted = [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  const groups: { label: string; items: AppNotification[] }[] = []
  sorted.forEach((item) => {
    const label = dayLabel(item.created_at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  })
  return groups
}

export function NotificationsPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const list = useNotificationsList()
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const items = useMemo(() => list.data ?? [], [list.data])
  const unreadCount = items.filter((item) => !item.is_read).length

  useAssistantScreen({
    screen: 'notifications',
    title: 'Уведомления',
    data: { total: items.length, unread: unreadCount },
    suggestions: ['Что мне нужно сделать сейчас?', 'Что означает мой статус?', 'Как часто обновляется статус?'],
  })

  const visible = filter === 'unread' ? items.filter((item) => !item.is_read) : items
  const groups = groupByDay(visible)

  function open(item: AppNotification) {
    if (!item.is_read) markRead.mutate(item.id)
    if (item.application_id) navigate(`/app/applications/${item.application_id}`)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Лента событий"
        title="Уведомления"
        description="Все изменения по заявкам приходят сюда — без почты, SMS и звонков."
        actions={
          <Button
            variant="secondary"
              icon={<CheckCheck size={16} />}
            disabled={unreadCount === 0}
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Прочитать все
          </Button>
        }
      />

      <div className={styles.toolbar}>
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'Все', count: items.length },
            { value: 'unread', label: 'Непрочитанные', count: unreadCount },
          ]}
        />
      </div>

      <div data-assist="notifications-list">
        {list.isLoading ? (
          <div className={styles.skeletons}>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} height={76} radius={14} />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : groups.length === 0 ? (
          <EmptyState icon={<BellOff size={22} />} title={filter === 'unread' ? 'Всё прочитано' : 'Уведомлений пока нет'}>
            {filter === 'unread'
              ? 'Новые события по заявкам появятся здесь автоматически.'
              : 'Когда вы отправите заявку, здесь появятся все этапы её рассмотрения.'}
          </EmptyState>
        ) : (
          <div className={styles.groups}>
            {groups.map((group) => (
              <section key={group.label} className={styles.group}>
                <h2 className={styles.day}>{group.label}</h2>
                <ul className={styles.list}>
                  {group.items.map((item) => {
                    const meta = notificationMeta[item.type]
                    const clickable = Boolean(item.application_id) || !item.is_read
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={cn(styles.item, !item.is_read && styles.unread, styles[meta.tone])}
                          onClick={() => open(item)}
                          disabled={!clickable}
                        >
                          <span className={styles.icon} aria-hidden>
                            {meta.icon}
                          </span>
                          <span className={styles.text}>
                            <span className={styles.meta}>
                              <span className={styles.type}>{notificationTypeLabels[item.type]}</span>
                              <span className={styles.time}>{formatTime(item.created_at)}</span>
                            </span>
                            <strong className={styles.title}>{item.title}</strong>
                            <span className={styles.body}>{item.body}</span>
                          </span>
                          {!item.is_read && <i className={styles.dot} aria-label="Не прочитано" />}
                          {item.application_id && <ChevronRight size={18} className={styles.chevron} aria-hidden />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

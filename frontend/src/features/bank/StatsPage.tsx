import type { CSSProperties } from 'react'
import { cn } from '@/shared/lib/cn'
import { formatMoneyShort, formatNumber, formatPercent } from '@/shared/lib/money'
import { statusMeta } from '@/shared/lib/statusMeta'
import { Card, EmptyState, ErrorState, PageHeader, PageLoader, Stat } from '@/shared/ui'
import { useBankStats } from './useBank'
import styles from './StatsPage.module.css'

function formatHours(hours: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(hours)} ч`
}

export function StatsPage() {
  const stats = useBankStats()

  if (stats.isLoading) return <PageLoader />
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
  const data = stats.data
  if (!data) return <EmptyState title="Нет данных" />

  const autoShare = data.auto_decision_share <= 1 ? data.auto_decision_share * 100 : data.auto_decision_share
  const max = Math.max(1, ...data.funnel.map((item) => item.count))

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Кредитный конвейер" title="Статистика" description="Показатели обновляются автоматически каждые 10 секунд." />
      <div className={styles.stats}>
        <Card padding="md">
          <Stat size="lg" label="Заявок за период" value={formatNumber(data.total)} />
        </Card>
        <Card padding="md">
          <Stat size="lg" label="Доля авто-решений" value={formatPercent(autoShare)} tone="accent" sub="без участия специалиста" />
        </Card>
        <Card padding="md">
          <Stat size="lg" label="Средняя сумма" value={formatMoneyShort(data.avg_amount)} />
        </Card>
        <Card padding="md">
          <Stat size="lg" label="Среднее время рассмотрения" value={formatHours(data.avg_review_hours)} sub="от подачи до решения" />
        </Card>
      </div>
      <Card title="Воронка по статусам" padding="md">
        {data.funnel.length ? (
          <div className={styles.funnel}>
            {data.funnel.map((item) => {
              const meta = statusMeta[item.status]
              return (
                <div key={item.status} className={styles.funnelRow}>
                  <span className={styles.funnelLabel}>{meta.title}</span>
                  <div className={styles.funnelTrack}>
                    <span
                      className={cn(styles.funnelBar, styles[`tone-${meta.tone}`])}
                      style={{ '--width': `${Math.max(2, (item.count / max) * 100)}%` } as CSSProperties}
                    />
                  </div>
                  <strong className={cn(styles.funnelCount, 'tabular')}>{formatNumber(item.count)}</strong>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState title="Заявок пока нет" />
        )}
      </Card>
    </div>
  )
}

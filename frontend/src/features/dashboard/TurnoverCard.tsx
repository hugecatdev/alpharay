import type { CompanyInsights } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { formatMonthLong } from '@/shared/lib/dates'
import { formatMoney } from '@/shared/lib/money'
import { Card, Skeleton, Stat } from '@/shared/ui'
import { TurnoverChart } from './TurnoverChart'
import styles from './Dashboard.module.css'

export function TurnoverCard({ insights, loading }: { insights: CompanyInsights | undefined; loading: boolean }) {
  const turnover = insights?.turnover ?? []
  const revenue = turnover.reduce((sum, month) => sum + month.inflow, 0)
  const best = turnover.reduce<(typeof turnover)[number] | undefined>(
    (top, month) => (!top || month.inflow > top.inflow ? month : top),
    undefined,
  )

  return (
    <Card
      title="Обороты по счёту"
      eyebrow="Последние 12 месяцев"
      assist="turnover-chart"
      className={styles.turnover}
      actions={<AskButton question="Как читать график оборотов и что он говорит о моём бизнесе?" />}
    >
      {loading ? (
        <div className={styles.stack}>
          <Skeleton height={56} />
          <Skeleton height={220} radius={12} />
        </div>
      ) : (
        <>
          <div className={styles.turnoverStats}>
            <Stat
              label="Средний свободный поток"
              value={formatMoney(insights?.avg_free_cash_flow ?? 0)}
              sub="в месяц, поступления минус списания"
              help={<AskButton question="Что такое свободный денежный поток и почему банк на него смотрит?" />}
            />
            <Stat
              label="Лучший месяц"
              value={best ? formatMoney(best.inflow) : '—'}
              sub={best ? formatMonthLong(best.month) : undefined}
            />
            <Stat label="Выручка за 12 мес" value={formatMoney(revenue)} sub="все поступления на счёт" />
          </div>
          <TurnoverChart data={turnover} />
        </>
      )}
    </Card>
  )
}

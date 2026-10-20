import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { formatMonthShort, formatMonthLong } from '@/shared/lib/dates'
import { formatMoney, formatMoneyShort } from '@/shared/lib/money'
import { Badge } from '@/shared/ui'
import type { LoanMetrics } from './metrics'
import styles from './CashFlowFit.module.css'

export function CashFlowFit({ metrics }: { metrics: LoanMetrics }) {
  const { fcf, monthly, fitCount } = metrics

  if (!fcf.length) {
    return (
      <section className={styles.card} data-assist="cashflow-fit">
        <header className={styles.header}>
          <h3>Впишется ли платёж</h3>
        </header>
        <p className={styles.empty}>
          Нет данных об оборотах по счёту — сравнить платёж с денежным потоком не получится. Банк оценит нагрузку по
          финансовым показателям из заявки.
        </p>
      </section>
    )
  }

  const peak = Math.max(...fcf.map((month) => month.value), monthly, 1) * 1.15
  const linePosition = Math.min(100, (monthly / peak) * 100)
  const tone = fitCount === fcf.length ? 'success' : fcf.length - fitCount > 3 ? 'danger' : 'warning'

  return (
    <section className={styles.card} data-assist="cashflow-fit">
      <header className={styles.header}>
        <div className={styles.titles}>
          <h3>
            Впишется ли платёж
            <AskButton question="Что такое свободный денежный поток и почему платёж должен в него вписываться?" />
          </h3>
          <span className={styles.caption}>
            Свободный денежный поток по месяцам (поступления минус списания по счёту) против платежа{' '}
            {formatMoneyShort(monthly)}
          </span>
        </div>
        <Badge tone={tone} dot>
          {fitCount} из {fcf.length} мес.
        </Badge>
      </header>
      <div className={styles.chart} role="img" aria-label={`Платёж вписывается в ${fitCount} из ${fcf.length} месяцев`}>
        <div className={styles.bars}>
          {fcf.map((month) => {
            const height = Math.max(2, (Math.max(0, month.value) / peak) * 100)
            const bad = month.value < monthly
            return (
              <div key={month.month} className={styles.column} title={`${formatMonthLong(month.month)}: ${formatMoney(month.value)}`}>
                <span className={cn(styles.bar, bad ? styles.bad : styles.good)} style={{ height: `${height}%` }} />
              </div>
            )
          })}
        </div>
        <div className={styles.payment} style={{ bottom: `${linePosition}%` }}>
          <span>платёж {formatMoneyShort(monthly)}</span>
        </div>
      </div>
      <div className={styles.months}>
        {fcf.map((month) => (
          <span key={month.month}>{formatMonthShort(month.month)}</span>
        ))}
      </div>
      <p className={styles.summary}>
        {fitCount === fcf.length
          ? 'Платёж вписывается во все месяцы за последний год.'
          : `Платёж вписывается в ${fitCount} из ${fcf.length} месяцев. В красные месяцы платить придётся из резервов.`}
      </p>
    </section>
  )
}

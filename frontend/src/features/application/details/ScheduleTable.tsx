import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { applicationsApi, queryKeys, type Application } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { formatDate } from '@/shared/lib/dates'
import { formatMoney } from '@/shared/lib/money'
import { Button, ErrorState, ProgressBar, Skeleton, Stat, Table } from '@/shared/ui'
import styles from './ScheduleTable.module.css'

const VISIBLE_ROWS = 12

function RepaymentProgress({ amount, balance, paidCount, total }: { amount: number; balance: number; paidCount: number; total: number }) {
  const repaid = Math.max(0, amount - balance)
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span>
          Погашено <b className="tabular">{formatMoney(repaid)}</b> из {formatMoney(amount)}
        </span>
        <span className="tabular">
          {paidCount} из {total} платежей
        </span>
      </div>
      <ProgressBar value={repaid} max={amount} tone="lime" height={10} label="Доля погашенного долга" />
    </div>
  )
}

export function ScheduleTable({ application }: { application: Application }) {
  const [expanded, setExpanded] = useState(false)
  const query = useQuery({
    queryKey: queryKeys.schedule(application.id),
    queryFn: () => applicationsApi.schedule(application.id),
  })

  const totals = useMemo(() => {
    const rows = query.data ?? []
    return rows.reduce(
      (sum, row) => ({ amount: sum.amount + row.amount, principal: sum.principal + row.principal, interest: sum.interest + row.interest }),
      { amount: 0, principal: 0, interest: 0 },
    )
  }, [query.data])

  if (query.isPending) {
    return (
      <div className={styles.loading}>
        <Skeleton height={60} radius={12} />
        <Skeleton height={220} radius={12} />
      </div>
    )
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  const schedule = query.data
  const now = Date.now()
  const next = schedule.find((row) => new Date(row.date).getTime() >= now)
  const paid = schedule.filter((row) => new Date(row.date).getTime() < now)
  const balance = paid.length ? paid[paid.length - 1].balance : application.amount
  const left = schedule.length - paid.length
  const visible = expanded ? schedule : schedule.slice(0, VISIBLE_ROWS)

  return (
    <div className={styles.block} data-assist="schedule">
      <div className={styles.stats}>
        <Stat label="Следующий платёж" value={next ? formatMoney(next.amount) : '—'} sub={next ? `до ${formatDate(next.date)}` : undefined} tone="accent" />
        <Stat label="Остаток долга" value={formatMoney(balance)} sub={`осталось платежей: ${left}`} />
        <Stat
          label="Проценты за весь срок"
          value={formatMoney(totals.interest)}
          help={<AskButton question="Из чего складывается мой ежемесячный платёж и как уменьшаются проценты?" />}
        />
      </div>

      {schedule.length > 0 && (
        <RepaymentProgress amount={application.amount} balance={balance} paidCount={paid.length} total={schedule.length} />
      )}

      <Table dense>
        <thead>
          <tr>
            <th>№</th>
            <th>Дата</th>
            <th className={styles.num}>Платёж</th>
            <th className={styles.num}>Основной долг</th>
            <th className={styles.num}>Проценты</th>
            <th className={styles.num}>Остаток</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr key={row.date} className={row === next ? styles.nextRow : undefined}>
              <td className={styles.index}>{index + 1}</td>
              <td>{formatDate(row.date)}</td>
              <td className={styles.num}>{formatMoney(row.amount)}</td>
              <td className={styles.num}>{formatMoney(row.principal)}</td>
              <td className={styles.num}>{formatMoney(row.interest)}</td>
              <td className={styles.num}>{formatMoney(row.balance)}</td>
            </tr>
          ))}
          {expanded || schedule.length <= VISIBLE_ROWS ? (
            <tr className={styles.totalRow}>
              <td />
              <td>Итого</td>
              <td className={styles.num}>{formatMoney(totals.amount)}</td>
              <td className={styles.num}>{formatMoney(totals.principal)}</td>
              <td className={styles.num}>{formatMoney(totals.interest)}</td>
              <td />
            </tr>
          ) : null}
        </tbody>
      </Table>

      {schedule.length > VISIBLE_ROWS && (
        <Button
          variant="ghost"
          size="sm"
          iconRight={expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Свернуть график' : `Показать весь график · ${schedule.length} платежей`}
        </Button>
      )}
    </div>
  )
}

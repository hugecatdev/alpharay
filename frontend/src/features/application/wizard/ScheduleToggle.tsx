import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { buildSchedule } from '@/shared/lib/annuity'
import { cn } from '@/shared/lib/cn'
import { formatDate } from '@/shared/lib/dates'
import { formatMoney } from '@/shared/lib/money'
import { Table } from '@/shared/ui'
import styles from './ScheduleToggle.module.css'

export function ScheduleToggle({ amount, term, rate }: { amount: number; term: number; rate: number }) {
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => (open ? buildSchedule(amount, term, rate) : []), [open, amount, term, rate])

  return (
    <div className={styles.root}>
      <button type="button" className={styles.toggle} onClick={() => setOpen(!open)} aria-expanded={open}>
        График платежей по месяцам
        <ChevronDown size={17} className={cn(styles.chevron, open && styles.chevronOpen)} />
      </button>
      {open && (
        <div className={styles.table}>
          <Table dense>
            <thead>
              <tr>
                <th>№</th>
                <th>Дата</th>
                <th>Платёж</th>
                <th>Основной долг</th>
                <th>Проценты</th>
                <th>Остаток</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((row, index) => (
                <tr key={row.date}>
                  <td>{index + 1}</td>
                  <td>{formatDate(row.date)}</td>
                  <td>{formatMoney(row.amount)}</td>
                  <td>{formatMoney(row.principal)}</td>
                  <td>{formatMoney(row.interest)}</td>
                  <td>{formatMoney(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  )
}

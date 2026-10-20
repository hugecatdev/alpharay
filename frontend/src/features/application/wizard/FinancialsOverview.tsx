import { Pencil } from 'lucide-react'
import type { TaxSystem, TurnoverMonth } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { formatMonthShort } from '@/shared/lib/dates'
import { taxSystemLabels } from '@/shared/lib/labels'
import { formatMoney, formatMoneyShort, formatPercent } from '@/shared/lib/money'
import { Button } from '@/shared/ui'
import styles from './FinancialsOverview.module.css'

export interface OverviewValues {
  revenue_12m: number
  revenue_m1: number
  revenue_m2: number
  revenue_m3: number
  expenses_12m: number
  net_profit_12m: number
  monthly_debt_payments: number
  employees_count: number
  tax_system: TaxSystem
}

interface FinancialsOverviewProps {
  values: OverviewValues
  turnover: TurnoverMonth[]
  fromAccount: boolean
  onEdit: () => void
}

function trendText(lastThree: number[], revenue: number): string | null {
  const recent = lastThree.reduce((sum, value) => sum + value, 0) / Math.max(lastThree.length, 1)
  const average = revenue / 12
  if (!recent || !average) return null
  const change = Math.round(((recent - average) / average) * 100)
  if (Math.abs(change) < 3) return 'на уровне среднего за год'
  return change > 0 ? `на ${change}% выше среднего за год` : `на ${Math.abs(change)}% ниже среднего за год`
}

export function FinancialsOverview({ values, turnover, fromAccount, onEdit }: FinancialsOverviewProps) {
  const margin = values.revenue_12m > 0 ? (values.net_profit_12m / values.revenue_12m) * 100 : 0
  const monthlyRevenue = values.revenue_12m / 12
  const debtShare = monthlyRevenue > 0 ? (values.monthly_debt_payments / monthlyRevenue) * 100 : 0
  const lastThree = [values.revenue_m1, values.revenue_m2, values.revenue_m3]
  const trend = trendText(lastThree, values.revenue_12m)
  const bars = turnover.slice(-12)
  const max = Math.max(...bars.map((month) => month.inflow), 1)

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div>
          <h3>{fromAccount ? 'Мы посчитали по выписке вашего счёта' : 'Ваши показатели'}</h3>
          <p>
            {fromAccount
              ? 'Последние 12 месяцев по расчётному счёту в AlphaRay. Если часть выручки идёт через другие банки — добавьте её.'
              : 'Проверьте цифры перед отправкой — банк сверит их с данными ФНС.'}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<Pencil size={15} />} onClick={onEdit}>
          Изменить данные
        </Button>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat} data-assist="revenue_12m">
          <span className={styles.label}>Выручка за год</span>
          <strong className="tabular">{formatMoneyShort(values.revenue_12m)}</strong>
          <span className={styles.why}>Из неё вы будете платить по кредиту</span>
        </div>
        <div className={styles.stat} data-assist="expenses_12m">
          <span className={styles.label}>Расходы за год</span>
          <strong className="tabular">{formatMoneyShort(values.expenses_12m)}</strong>
          <span className={styles.why}>Закупки, зарплаты, аренда и налоги</span>
        </div>
        <div className={styles.stat} data-assist="net_profit_12m">
          <span className={styles.label}>Чистая прибыль</span>
          <strong className={cn('tabular', values.net_profit_12m < 0 && styles.negative)}>{formatMoneyShort(values.net_profit_12m)}</strong>
          <span className={styles.why}>
            Рентабельность {formatPercent(margin, 1)} — запас на платежи
          </span>
        </div>
      </div>

      {bars.length > 0 && (
        <div className={styles.trend} data-assist="revenue_last_3m">
          <div className={styles.trendHead}>
            <span className={styles.label}>
              Выручка по месяцам
              <AskButton question="Зачем банку динамика выручки за последние месяцы?" />
            </span>
            {trend && <span className={styles.trendText}>Последние 3 месяца {trend}</span>}
          </div>
          <div className={styles.bars} role="img" aria-label="Выручка по месяцам за последний год">
            {bars.map((month, index) => (
              <span key={month.month} className={styles.barCol} title={`${formatMonthShort(month.month)}: ${formatMoney(month.inflow)}`}>
                <i className={cn(styles.bar, index >= bars.length - 3 && styles.barRecent)} style={{ height: `${Math.max(6, (month.inflow / max) * 100)}%` }} />
                <span>{formatMonthShort(month.month)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className={styles.rows}>
        <div className={styles.row} data-assist="monthly_debt_payments">
          <span className={styles.rowLabel}>
            Платежи по текущим кредитам
            <span className={styles.why}>Банк смотрит, сколько выручки уже уходит на долги</span>
          </span>
          <span className={styles.rowValue}>
            <strong className="tabular">{formatMoney(values.monthly_debt_payments)}</strong>
            <span className={cn(styles.share, debtShare > 30 ? styles.shareHigh : debtShare > 15 ? styles.shareMid : styles.shareLow)}>
              {formatPercent(debtShare)} месячной выручки
            </span>
          </span>
        </div>
        <div className={styles.row} data-assist="tax_system">
          <span className={styles.rowLabel}>
            Сотрудники и налоги
            <span className={styles.why}>Из профиля компании</span>
          </span>
          <span className={styles.rowValue} data-assist="employees_count">
            <strong className="tabular">
              {values.employees_count} чел. · {taxSystemLabels[values.tax_system]}
            </strong>
          </span>
        </div>
      </div>
    </div>
  )
}

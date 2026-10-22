import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { BankApplication, Discrepancy, Financials } from '@/api'
import { creditSummary } from '@/shared/lib/annuity'
import { cn } from '@/shared/lib/cn'
import { taxSystemLabels } from '@/shared/lib/labels'
import { formatMoney, formatNumber, formatPercent } from '@/shared/lib/money'
import { Alert, Card, Stat } from '@/shared/ui'
import styles from './FinancialsCard.module.css'

type Severity = 'danger' | 'warning'

function severity(discrepancy: Discrepancy): Severity {
  return Math.abs(discrepancy.diff_percent) >= 20 ? 'danger' : 'warning'
}

interface Row {
  field: keyof Financials
  label: string
  value: ReactNode
}

function rows(financials: Financials): Row[] {
  return [
    { field: 'revenue_12m', label: 'Выручка за 12 мес', value: formatMoney(financials.revenue_12m) },
    {
      field: 'revenue_last_3m',
      label: 'Выручка за последние 3 мес',
      value: financials.revenue_last_3m.map((value) => formatNumber(value)).join(' · ') + ' ₽',
    },
    { field: 'expenses_12m', label: 'Расходы за 12 мес', value: formatMoney(financials.expenses_12m) },
    { field: 'net_profit_12m', label: 'Чистая прибыль за 12 мес', value: formatMoney(financials.net_profit_12m) },
    { field: 'monthly_debt_payments', label: 'Текущие платежи по кредитам', value: `${formatMoney(financials.monthly_debt_payments)} / мес` },
    { field: 'employees_count', label: 'Сотрудников', value: formatNumber(financials.employees_count) },
    { field: 'tax_system', label: 'Система налогообложения', value: taxSystemLabels[financials.tax_system] },
  ]
}

export function DiscrepancyTable({ discrepancies }: { discrepancies: Discrepancy[] }) {
  if (!discrepancies.length) return null
  return (
    <div className={styles.discrepancies}>
      <div className={styles.discHead}>
        <span>Показатель</span>
        <span>Заявлено</span>
        <span>Внешний источник</span>
        <span>Расхождение</span>
      </div>
      {discrepancies.map((item) => (
        <div key={item.field} className={cn(styles.discRow, styles[severity(item)])} title="Расхождение с ФНС">
          <span className={styles.discLabel}>
            <AlertTriangle size={14} />
            {item.label}
          </span>
          <span className="tabular">{formatMoney(item.declared)}</span>
          <span className="tabular">{formatMoney(item.external)}</span>
          <strong className="tabular">{formatPercent(item.diff_percent, 1)}</strong>
        </div>
      ))}
    </div>
  )
}

export function FinancialsCard({ application }: { application: BankApplication }) {
  const financials = application.financials
  if (!financials) {
    return (
      <Card title="Финансы из заявки" padding="md">
        <Alert tone="neutral">Клиент не заполнил финансовые показатели.</Alert>
      </Card>
    )
  }

  const list = rows(financials)
  const byField = new Map(application.discrepancies.map((item) => [item.field, item]))
  const extra = application.discrepancies.filter((item) => !list.some((row) => row.field === item.field))
  const monthlyRevenue = financials.revenue_12m / 12
  const newPayment = creditSummary(
    application.product.repayment,
    application.amount,
    application.term,
    application.product.base_rate,
  ).monthly_payment
  const debtLoad = monthlyRevenue > 0 ? ((financials.monthly_debt_payments + newPayment) / monthlyRevenue) * 100 : 0
  const margin = financials.revenue_12m > 0 ? (financials.net_profit_12m / financials.revenue_12m) * 100 : 0
  const amountToRevenue = financials.revenue_12m > 0 ? (application.amount / financials.revenue_12m) * 100 : 0

  return (
    <Card
      title="Финансы из заявки"
      padding="md"
      actions={
        application.discrepancies.length > 0 ? (
          <span className={styles.discBadge}>
            <AlertTriangle size={14} /> Расхождений с ФНС: {application.discrepancies.length}
          </span>
        ) : undefined
      }
    >
      <div className={styles.ratios}>
        <Stat size="sm" label="Платежи к выручке с новым кредитом" value={formatPercent(debtLoad)} tone={debtLoad > 50 ? 'accent' : 'default'} sub="все платежи / выручка в мес" />
        <Stat size="sm" label="Рентабельность" value={formatPercent(margin, 1)} tone={margin < 5 ? 'accent' : 'default'} sub="прибыль / выручка" />
        <Stat size="sm" label="Сумма к выручке" value={formatPercent(amountToRevenue)} tone={amountToRevenue > 50 ? 'accent' : 'default'} sub="запрошено / выручка за год" />
      </div>
      <div className={styles.table}>
        {list.map((row) => {
          const discrepancy = byField.get(row.field)
          return (
            <div
              key={row.field}
              className={cn(styles.row, discrepancy && styles[severity(discrepancy)])}
              title={discrepancy ? 'Расхождение с ФНС' : undefined}
            >
              <span className={styles.label}>
                {discrepancy && <AlertTriangle size={14} />}
                {row.label}
              </span>
              <span className={styles.value}>
                {row.value}
                {discrepancy && (
                  <em className={styles.external}>
                    ФНС: {formatMoney(discrepancy.external)} · {formatPercent(discrepancy.diff_percent, 1)}
                  </em>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <DiscrepancyTable discrepancies={extra} />
    </Card>
  )
}

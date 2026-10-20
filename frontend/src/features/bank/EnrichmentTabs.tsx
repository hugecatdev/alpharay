import { useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { BankApplication, BkiLoan } from '@/api'
import { cn } from '@/shared/lib/cn'
import { formatBusinessAge, formatDate } from '@/shared/lib/dates'
import { formatMoney } from '@/shared/lib/money'
import { Alert, Badge, Card, KeyValueList, Table, Tabs } from '@/shared/ui'
import styles from './EnrichmentTabs.module.css'

type Source = 'egrul' | 'fns' | 'bki'

function Flag({ bad, okText, badText }: { bad: boolean; okText: string; badText: string }) {
  return (
    <span className={cn(styles.flag, bad ? styles.flagBad : styles.flagOk)}>
      {bad ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {bad ? badText : okText}
    </span>
  )
}

function overdueTone(days: number): 'success' | 'warning' | 'danger' {
  if (days === 0) return 'success'
  if (days <= 30) return 'warning'
  return 'danger'
}

function LoansTable({ loans, closed }: { loans: BkiLoan[]; closed?: boolean }) {
  return (
    <Table dense>
      <thead>
        <tr>
          <th>Кредитор</th>
          <th>Сумма</th>
          {!closed && <th>Остаток</th>}
          <th>Открыт</th>
          {closed && <th>Закрыт</th>}
          <th>Макс. просрочка</th>
        </tr>
      </thead>
      <tbody>
        {loans.map((loan, index) => (
          <tr key={`${loan.creditor}-${loan.opened_at}-${index}`}>
            <td>{loan.creditor}</td>
            <td className="tabular">{formatMoney(loan.amount)}</td>
            {!closed && <td className="tabular">{formatMoney(loan.balance)}</td>}
            <td className="tabular">{formatDate(loan.opened_at)}</td>
            {closed && <td className="tabular">{loan.closed_at ? formatDate(loan.closed_at) : '—'}</td>}
            <td>
              <Badge tone={overdueTone(loan.max_overdue_days)}>
                {loan.max_overdue_days === 0 ? 'нет' : `${loan.max_overdue_days} дн.`}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {children}
    </div>
  )
}

export function EnrichmentTabs({ application }: { application: BankApplication }) {
  const [source, setSource] = useState<Source>('egrul')
  const enrichment = application.enrichment

  if (!enrichment) {
    return (
      <Card title="Данные из внешних источников" padding="md">
        <Alert tone="neutral" title="Данные ещё не получены">
          Конвейер запрашивает ЕГРЮЛ, ФНС и бюро кредитных историй после отправки заявки.
        </Alert>
      </Card>
    )
  }

  const { egrul, fns, bki } = enrichment
  const fnsIssues = [fns.tax_debt > 0, fns.account_blocks, fns.mass_address, fns.disqualified_head].filter(Boolean).length
  const bkiIssue = bki.max_overdue_days_24m > 0

  return (
    <Card
      title="Данные из внешних источников"
      padding="md"
      actions={
        <Tabs
          value={source}
          onChange={setSource}
          items={[
            { value: 'egrul', label: 'ЕГРЮЛ' },
            { value: 'fns', label: 'ФНС', count: fnsIssues || undefined },
            { value: 'bki', label: 'БКИ', count: bkiIssue ? 1 : undefined },
          ]}
        />
      }
    >
      {source === 'egrul' && (
        <KeyValueList
          columns={2}
          items={[
            {
              label: 'Статус',
              value: egrul.status,
              tone: /действ|active/i.test(egrul.status) ? 'success' : 'danger',
            },
            { label: 'ОГРН', value: egrul.ogrn },
            {
              label: 'Дата регистрации',
              value: `${formatDate(egrul.registration_date)} · ${formatBusinessAge(egrul.registration_date)}`,
            },
            { label: 'ОКВЭД', value: `${egrul.okved_main} ${egrul.okved_name}` },
            { label: 'Руководитель', value: egrul.head_name },
            { label: 'Адрес', value: egrul.address },
          ]}
        />
      )}

      {source === 'fns' && (
        <KeyValueList
          columns={1}
          items={[
            {
              label: 'Налоговая задолженность',
              value: fns.tax_debt > 0 ? <Flag bad okText="" badText={formatMoney(fns.tax_debt)} /> : <Flag bad={false} okText="Нет" badText="" />,
            },
            {
              label: 'Блокировки счетов',
              value: <Flag bad={fns.account_blocks} okText="Нет" badText="Есть решения о блокировке" />,
            },
            {
              label: 'Массовый адрес',
              value: <Flag bad={fns.mass_address} okText="Нет" badText="Адрес массовой регистрации" />,
            },
            {
              label: 'Дисквалификация руководителя',
              value: <Flag bad={fns.disqualified_head} okText="Нет" badText="Руководитель дисквалифицирован" />,
            },
            { label: 'Задекларированная выручка за 12 мес', value: formatMoney(fns.declared_revenue_12m) },
          ]}
        />
      )}

      {source === 'bki' && (
        <div className={styles.bki}>
          <div className={styles.bkiStats}>
            <div className={styles.bkiStat}>
              <span>Рейтинг БКИ</span>
              <strong className="tabular">{bki.rating}</strong>
              <em>{bki.rating_label}</em>
            </div>
            <div className={styles.bkiStat}>
              <span>Макс. просрочка за 24 мес</span>
              <strong className={cn('tabular', bkiIssue && styles.bad)}>
                {bki.max_overdue_days_24m === 0 ? 'Нет' : `${bki.max_overdue_days_24m} дн.`}
              </strong>
            </div>
            <div className={styles.bkiStat}>
              <span>Активные / закрытые</span>
              <strong className="tabular">
                {bki.active_loans.length} / {bki.closed_loans.length}
              </strong>
            </div>
          </div>
          <Section title="Активные кредиты">
            {bki.active_loans.length ? <LoansTable loans={bki.active_loans} /> : <p className={styles.none}>Активных кредитов нет</p>}
          </Section>
          <Section title="Закрытые кредиты">
            {bki.closed_loans.length ? (
              <LoansTable loans={bki.closed_loans} closed />
            ) : (
              <p className={styles.none}>Кредитная история пуста</p>
            )}
          </Section>
        </div>
      )}
    </Card>
  )
}

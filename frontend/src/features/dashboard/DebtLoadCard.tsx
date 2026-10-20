import { Landmark } from 'lucide-react'
import type { CompanyInsights } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { formatDate } from '@/shared/lib/dates'
import { formatMoney, formatPercent } from '@/shared/lib/money'
import { Card, ProgressBar, Skeleton } from '@/shared/ui'
import styles from './Dashboard.module.css'

export function DebtLoadCard({ insights, loading }: { insights: CompanyInsights | undefined; loading: boolean }) {
  const loans = insights?.loans ?? []
  const totalBalance = loans.reduce((sum, loan) => sum + loan.balance, 0)
  const totalMonthly = loans.reduce((sum, loan) => sum + loan.monthly_payment, 0)
  const flow = insights?.avg_free_cash_flow ?? 0
  const share = flow > 0 ? (totalMonthly / flow) * 100 : 0
  const shareTone = share > 70 ? 'red' : share > 40 ? 'amber' : 'green'

  return (
    <Card
      title="Долговая нагрузка"
      eyebrow="Действующие кредиты"
      assist="loans"
      className={styles.debtCard}
      actions={<AskButton question="Как банк оценивает мою долговую нагрузку и сколько ещё можно взять?" />}
    >
      {loading ? (
        <div className={styles.stack}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={8} />
          <Skeleton height={20} width="80%" />
        </div>
      ) : loans.length === 0 ? (
        <div className={styles.debtEmpty}>
          <span className={styles.debtEmptyIcon} aria-hidden>
            <Landmark size={20} />
          </span>
          <div>
            <strong>Кредитов нет</strong>
            <p>Долговой нагрузки нет — это плюс при рассмотрении новой заявки.</p>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.debtTotals}>
            <div>
              <span>Остаток долга</span>
              <strong className="tabular">{formatMoney(totalBalance)}</strong>
            </div>
            <div>
              <span>Платежи в месяц</span>
              <strong className="tabular">{formatMoney(totalMonthly)}</strong>
            </div>
          </div>

          <ul className={styles.loanList}>
            {loans.map((loan) => {
              const repaid = Math.max(0, loan.amount - loan.balance)
              const percent = loan.amount > 0 ? (repaid / loan.amount) * 100 : 0
              return (
                <li key={loan.id} className={styles.loan}>
                  <div className={styles.loanHead}>
                    <strong>{loan.product_name}</strong>
                    <span className="tabular">№ {loan.contract_number}</span>
                  </div>
                  <div className={styles.loanBarLabel}>
                    <span>долг</span>
                    <span className="tabular">погашено {formatPercent(percent)}</span>
                  </div>
                  <ProgressBar value={repaid} max={loan.amount} tone="lime" label="Погашено" />
                  <div className={styles.loanMeta}>
                    <span>
                      Остаток <b className="tabular">{formatMoney(loan.balance)}</b>
                    </span>
                    <span>
                      Платёж <b className="tabular">{formatMoney(loan.monthly_payment)}</b>
                    </span>
                    <span>
                      Следующий <b className="tabular">{formatDate(loan.next_payment_date)}</b>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {!loading && flow > 0 && (
        <div className={styles.flowShare}>
          <div className={styles.flowShareHead}>
            <span>
              Нагрузка на свободный поток
              <AskButton question="Что такое нагрузка на свободный денежный поток и какой уровень безопасен?" />
            </span>
            <strong className={cn('tabular', styles[`share-${shareTone}`])}>{formatPercent(share)}</strong>
          </div>
          <ProgressBar value={Math.min(share, 100)} max={100} tone={shareTone} height={5} label="Нагрузка на поток" />
          <p>
            Средний свободный поток — <b className="tabular">{formatMoney(flow)}</b> в месяц. Комфортно, когда платежи
            занимают до 40%.
          </p>
        </div>
      )}
    </Card>
  )
}

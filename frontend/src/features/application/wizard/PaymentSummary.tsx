import { AskButton } from '@/features/assistant/AskButton'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { FadeValue } from '@/shared/ui'
import type { LoanMetrics } from './metrics'
import styles from './PaymentSummary.module.css'

export function PaymentSummary({ metrics, rate }: { metrics: LoanMetrics; rate: number }) {
  return (
    <div className={styles.panel} data-assist="payment-summary">
      <div className={styles.monthly}>
        <span className={styles.label}>
          Каждый месяц
          <AskButton question="Из чего складывается ежемесячный платёж?" />
        </span>
        <strong className={styles.big}>
          <FadeValue value={formatMoney(metrics.monthly)} />
        </strong>
        <span className={styles.rate}>
          Ставка от {formatRate(rate)} годовых · аннуитетный платёж
        </span>
      </div>
      <div className={styles.details}>
        <div data-assist="overpayment">
          <span className={styles.label}>
            Проценты за весь срок
            <AskButton question="Что такое переплата и как её уменьшить?" />
          </span>
          <strong>
            <FadeValue value={formatMoney(metrics.overpayment)} />
          </strong>
        </div>
        <div>
          <span className={styles.label}>Всего к возврату</span>
          <strong>
            <FadeValue value={formatMoney(metrics.total)} />
          </strong>
        </div>
      </div>
      <p className={styles.note}>Предварительный расчёт. Итоговые условия определяет банк.</p>
    </div>
  )
}

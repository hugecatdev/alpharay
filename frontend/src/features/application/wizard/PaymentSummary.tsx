import { AskButton } from '@/features/assistant/AskButton'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { FadeValue } from '@/shared/ui'
import type { LoanMetrics } from './metrics'
import styles from './PaymentSummary.module.css'

export function PaymentSummary({ metrics, rate }: { metrics: LoanMetrics; rate: number }) {
  if (metrics.revolving) {
    return (
      <div className={styles.panel} data-assist="payment-summary">
        <div className={styles.monthly}>
          <span className={styles.label}>
            Проценты в месяц при полном использовании
            <AskButton question="Как начисляются проценты по овердрафту и как он гасится?" />
          </span>
          <strong className={styles.big}>
            <FadeValue value={formatMoney(metrics.monthly)} />
          </strong>
          <span className={styles.rate}>Ставка от {formatRate(rate)} годовых · только на использованную сумму</span>
        </div>
        <div className={styles.details}>
          <div>
            <span className={styles.label}>Как гасится</span>
            <strong>Поступлениями на счёт</strong>
          </div>
          <div>
            <span className={styles.label}>Каждый транш</span>
            <strong>до 60 дней</strong>
          </div>
        </div>
        <p className={styles.note}>
          Графика платежей нет: не используете лимит — не платите. Предварительный расчёт, условия определяет банк.
        </p>
      </div>
    )
  }
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
          {metrics.existing > 0 && <> · с текущими кредитами {formatMoney(metrics.monthly + metrics.existing)}</>}
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

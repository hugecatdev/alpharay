import { useEffect } from 'react'
import { formatMoney, formatMoneyShort } from '@/shared/lib/money'
import { Badge, FadeValue } from '@/shared/ui'
import { checkLevelMeta, type CheckLevel } from './metrics'
import styles from './SummaryBar.module.css'

interface SummaryBarProps {
  productName: string | null
  amount: number | null
  term: number | null
  monthly: number | null
  level: CheckLevel | null
  revolving?: boolean
}

export function SummaryBar({ productName, amount, term, monthly, level, revolving = false }: SummaryBarProps) {
  const meta = level ? checkLevelMeta[level] : null
  useEffect(() => {
    document.documentElement.dataset.subbar = 'on'
    return () => {
      delete document.documentElement.dataset.subbar
    }
  }, [])
  return (
    <div className={styles.bar} aria-label="Параметры заявки">
      <div className={styles.cell}>
        <span className={styles.key}>Продукт</span>
        <span className={styles.value} title={productName ?? undefined}>
          {productName ?? '—'}
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.key}>{revolving ? 'Лимит' : 'Сумма'}</span>
        <span className={styles.value}>
          <FadeValue value={amount ? formatMoneyShort(amount) : '—'} />
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.key}>Срок</span>
        <span className={styles.value}>
          <FadeValue value={term ? `${term} мес.` : '—'} />
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.key}>{revolving ? 'Проценты, макс.' : 'В месяц'}</span>
        <span className={styles.value}>
          <FadeValue value={monthly ? formatMoney(monthly) : '—'} />
        </span>
      </div>
      <div className={styles.cell}>
        <span className={styles.key}>Оценка</span>
        <span className={styles.value}>
          {meta ? (
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
          ) : (
            '—'
          )}
        </span>
      </div>
    </div>
  )
}

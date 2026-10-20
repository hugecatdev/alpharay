import { useMemo } from 'react'
import type { CompanyInsights, Product } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/money'
import { FadeValue } from '@/shared/ui'
import { computeMetrics, formatShare, type LoanMetrics } from './metrics'
import styles from './TermCompare.module.css'

const TERM_GRID = [3, 6, 9, 12, 18, 24, 36, 48, 60]

function termOptions(term: number, product: Product): number[] {
  const grid = TERM_GRID.filter((value) => value >= product.min_term && value <= product.max_term)
  const lower = [...grid].reverse().find((value) => value < term)
  const higher = grid.find((value) => value > term)
  const options = [lower, term, higher].filter((value): value is number => value !== undefined)
  for (const value of grid) {
    if (options.length >= 3) break
    if (!options.includes(value)) options.push(value)
  }
  return options.sort((a, b) => a - b).slice(0, 3)
}

interface Option {
  term: number
  metrics: LoanMetrics
}

export function TermCompare({
  amount,
  term,
  rate,
  product,
  insights,
  onSelect,
}: {
  amount: number
  term: number
  rate: number
  product: Product
  insights?: CompanyInsights
  onSelect: (term: number) => void
}) {
  const options = useMemo<Option[]>(
    () => termOptions(term, product).map((value) => ({ term: value, metrics: computeMetrics(amount, value, rate, insights) })),
    [amount, term, rate, product, insights],
  )
  const optimal = options.find((option) => option.metrics.riskLevel === 'low')?.term

  return (
    <section className={styles.root} data-assist="term-compare">
      <div className={styles.head}>
        <div>
          <h4>Сравните сроки</h4>
          <p>Короче срок — меньше переплата. Длиннее — ниже платёж.</p>
        </div>
        <AskButton question="Как выбрать срок кредита для моего бизнеса?" />
      </div>
      <div className={styles.grid}>
        {options.map((option) => {
          const selected = option.term === term
          return (
            <button
              key={option.term}
              type="button"
              className={cn(styles.option, selected && styles.selected)}
              onClick={() => onSelect(option.term)}
              aria-pressed={selected}
            >
              <span className={styles.optionTop}>
                <strong>{option.term} мес.</strong>
                {option.term === optimal && <span className={styles.badge}>Оптимально</span>}
              </span>
              <span className={styles.payment}>
                <FadeValue value={formatMoney(option.metrics.monthly)} />
                <small>/мес</small>
              </span>
              <span className={styles.row}>
                <span>Переплата</span>
                <b>
                  <FadeValue value={formatMoney(option.metrics.overpayment)} />
                </b>
              </span>
              <span className={styles.row}>
                <span>Нагрузка на поток</span>
                <b className={styles[option.metrics.riskLevel]}>{formatShare(option.metrics.share)}</b>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

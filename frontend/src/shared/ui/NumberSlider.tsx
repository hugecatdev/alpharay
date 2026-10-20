import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import { formatNumber, parseMoneyInput } from '@/shared/lib/money'
import styles from './NumberSlider.module.css'

interface NumberSliderProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (value: number) => void
  formatEnd?: (value: number) => string
  help?: ReactNode
  error?: string
  accent?: 'red' | 'green'
  assist?: string
  disabled?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  formatEnd = formatNumber,
  help,
  error,
  accent = 'red',
  assist,
  disabled,
}: NumberSliderProps) {
  const id = useId()
  const [draft, setDraft] = useState(formatNumber(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(formatNumber(value))
  }, [value, focused])

  const progress = max > min ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0

  function commit() {
    const parsed = parseMoneyInput(draft)
    const next = clamp(Math.round(parsed / step) * step || min, min, max)
    onChange(next)
    setDraft(formatNumber(next))
  }

  return (
    <div className={cn(styles.root, error && styles.invalid, styles[accent])} data-assist={assist}>
      <div className={styles.labelRow}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {help}
      </div>
      <div className={styles.line}>
        <input
          id={id}
          className={styles.input}
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setFocused(false)
            commit()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        <span className={styles.suffix}>{suffix}</span>
      </div>
      <input
        type="range"
        className={styles.range}
        min={min}
        max={max}
        step={step}
        value={clamp(value, min, max)}
        disabled={disabled}
        aria-label={typeof label === 'string' ? label : undefined}
        style={{ '--progress': `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className={styles.ends}>
        <span>{formatEnd(min)}</span>
        <span>{formatEnd(max)}</span>
      </div>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}

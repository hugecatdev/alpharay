import { useEffect, useState } from 'react'
import { formatNumber, parseMoneyInput } from '@/shared/lib/money'
import { Input } from '@/shared/ui'

interface MoneyInputProps {
  id: string
  value: number | undefined
  onChange: (value: number) => void
  onBlur?: () => void
  invalid?: boolean
  suffix?: string
  allowNegative?: boolean
  placeholder?: string
}

function format(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value) || value === 0) return ''
  return value < 0 ? `−${formatNumber(Math.abs(value))}` : formatNumber(value)
}

export function MoneyInput({ id, value, onChange, onBlur, invalid, suffix = '₽', allowNegative, placeholder = '0' }: MoneyInputProps) {
  const [draft, setDraft] = useState(format(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setDraft(format(value))
  }, [value, focused])

  return (
    <Input
      id={id}
      inputMode="numeric"
      value={draft}
      invalid={invalid}
      suffix={suffix}
      placeholder={placeholder}
      className="tabular"
      onFocus={() => setFocused(true)}
      onChange={(event) => {
        const raw = event.target.value
        const negative = allowNegative && /^\s*[-−]/.test(raw)
        const parsed = parseMoneyInput(raw)
        const next = negative ? -parsed : parsed
        setDraft(raw)
        onChange(next)
      }}
      onBlur={() => {
        setFocused(false)
        setDraft(format(value))
        onBlur?.()
      }}
    />
  )
}

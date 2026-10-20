import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'
import styles from './Field.module.css'

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string
  help?: ReactNode
  assist?: string
  className?: string
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, help, assist, className, children }: FieldProps) {
  const id = useId()
  return (
    <div className={cn(styles.field, error && styles.invalid, className)} data-assist={assist}>
      {(label || help) && (
        <div className={styles.labelRow}>
          {label && (
            <label htmlFor={id} className={styles.label}>
              {label}
            </label>
          )}
          {help}
        </div>
      )}
      {children(id)}
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  suffix?: ReactNode
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ suffix, invalid, className, ...rest }, ref) {
  return (
    <div className={cn(styles.control, invalid && styles.controlInvalid, rest.readOnly && styles.readOnly, className)}>
      <input ref={ref} className={styles.input} {...rest} />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return (
      <div className={cn(styles.control, invalid && styles.controlInvalid, className)}>
        <textarea ref={ref} className={cn(styles.input, styles.textarea)} {...rest} />
      </div>
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className, children, ...rest }, ref) {
    return (
      <div className={cn(styles.control, styles.selectControl, invalid && styles.controlInvalid, className)}>
        <select ref={ref} className={cn(styles.input, styles.select)} {...rest}>
          {children}
        </select>
      </div>
    )
  },
)

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  description?: ReactNode
  invalid?: boolean
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, invalid, className, ...rest },
  ref,
) {
  return (
    <label className={cn(styles.checkbox, invalid && styles.checkboxInvalid, rest.disabled && styles.checkboxDisabled, className)}>
      <input ref={ref} type="checkbox" className={styles.checkboxInput} {...rest} />
      <span className={styles.checkboxBox} aria-hidden>
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className={styles.checkboxText}>
        <span>{label}</span>
        {description && <span className={styles.checkboxDescription}>{description}</span>}
      </span>
    </label>
  )
})

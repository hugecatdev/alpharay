import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import styles from './Misc.module.css'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

const alertIcons: Record<AlertTone, ReactNode> = {
  info: <Info size={18} />,
  success: <CheckCircle2 size={18} />,
  warning: <AlertTriangle size={18} />,
  danger: <XCircle size={18} />,
  neutral: <Info size={18} />,
}

export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  icon,
  className,
  assist,
}: {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  className?: string
  assist?: string
}) {
  return (
    <div className={cn(styles.alert, styles[`alert-${tone}`], className)} role={tone === 'danger' ? 'alert' : 'status'} data-assist={assist}>
      <span className={styles.alertIcon}>{icon ?? alertIcons[tone]}</span>
      <div className={styles.alertBody}>
        {title && <strong className={styles.alertTitle}>{title}</strong>}
        {children && <div className={styles.alertText}>{children}</div>}
        {actions && <div className={styles.alertActions}>{actions}</div>}
      </div>
    </div>
  )
}

export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <span className={styles.spinnerWrap} role="status">
      <span className={styles.spinner} style={{ width: size, height: size }} aria-hidden />
      {label && <span className={styles.spinnerLabel}>{label}</span>}
    </span>
  )
}

export function PageLoader({ label = 'Загружаем…' }: { label?: string }) {
  return (
    <div className={styles.pageLoader}>
      <Spinner size={26} label={label} />
    </div>
  )
}

export function Skeleton({ height = 16, width = '100%', radius = 8 }: { height?: number; width?: number | string; radius?: number }) {
  return <span className={styles.skeleton} style={{ height, width, borderRadius: radius }} aria-hidden />
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className={styles.empty}>
      {icon && <span className={styles.emptyIcon}>{icon}</span>}
      <strong className={styles.emptyTitle}>{title}</strong>
      {children && <p className={styles.emptyText}>{children}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Что-то пошло не так'
  return (
    <Alert
      tone="danger"
      title="Не удалось загрузить данные"
      actions={
        onRetry && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            Повторить
          </button>
        )
      }
    >
      {message}
    </Alert>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  status,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  status?: ReactNode
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderMain}>
        {eyebrow && <span className={styles.pageEyebrow}>{eyebrow}</span>}
        <div className={styles.pageTitleRow}>
          <h1>{title}</h1>
          {status}
        </div>
        {description && <p className={styles.pageDescription}>{description}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  )
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  size = 'md',
  help,
  assist,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'accent' | 'success' | 'muted'
  size?: 'sm' | 'md' | 'lg'
  help?: ReactNode
  assist?: string
}) {
  return (
    <div className={cn(styles.stat, styles[`stat-${size}`])} data-assist={assist}>
      <span className={styles.statLabel}>
        {label}
        {help}
      </span>
      <strong className={cn(styles.statValue, styles[`statTone-${tone}`], 'tabular')}>{value}</strong>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  )
}

export function KeyValueList({
  items,
  columns = 1,
}: {
  items: { label: ReactNode; value: ReactNode; tone?: 'default' | 'danger' | 'success' | 'warning' }[]
  columns?: 1 | 2 | 3
}) {
  return (
    <dl className={cn(styles.kv, styles[`kv-${columns}`])}>
      {items.map((item, index) => (
        <div key={index} className={styles.kvRow}>
          <dt>{item.label}</dt>
          <dd className={item.tone ? styles[`kvTone-${item.tone}`] : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ProgressBar({
  value,
  max = 100,
  tone = 'red',
  height = 6,
  label,
}: {
  value: number
  max?: number
  tone?: 'red' | 'green' | 'lime' | 'violet' | 'amber' | 'blue'
  height?: number
  label?: string
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={styles.progress}
      style={{ height }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
    >
      <span className={cn(styles.progressFill, styles[`progress-${tone}`])} style={{ width: `${percent}%` }} />
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  size = 'md',
}: {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: ReactNode; count?: number }[]
  size?: 'sm' | 'md'
}) {
  return (
    <div className={cn(styles.tabs, styles[`tabs-${size}`])} role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={item.value === value}
          className={cn(styles.tab, item.value === value && styles.tabActive)}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined && <span className={styles.tabCount}>{item.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  meta,
  badge,
  icon,
  disabled,
  assist,
}: {
  selected: boolean
  onSelect: () => void
  title: ReactNode
  description?: ReactNode
  meta?: ReactNode
  badge?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  assist?: string
}) {
  return (
    <button
      type="button"
      className={cn(styles.choice, selected && styles.choiceSelected)}
      onClick={onSelect}
      aria-pressed={selected}
      disabled={disabled}
      data-assist={assist}
    >
      {icon || badge ? (
        <>
          <span className={styles.choiceTop}>
            {icon && <span className={styles.choiceIcon}>{icon}</span>}
            {badge}
            <span className={styles.choiceRadio} aria-hidden />
          </span>
          <span className={styles.choiceTitle}>{title}</span>
        </>
      ) : (
        <span className={styles.choiceTop}>
          <span className={styles.choiceTitle}>{title}</span>
          <span className={styles.choiceRadio} aria-hidden />
        </span>
      )}
      {description && <span className={styles.choiceDescription}>{description}</span>}
      {meta && <span className={styles.choiceMeta}>{meta}</span>}
    </button>
  )
}

export function Stepper({
  steps,
  current,
  completed,
  onSelect,
}: {
  steps: { key: string; title: string }[]
  current: number
  completed: number
  onSelect?: (index: number) => void
}) {
  return (
    <ol className={styles.stepper}>
      {steps.map((step, index) => {
        const state = index === current ? 'current' : index <= completed ? 'done' : 'todo'
        const clickable = onSelect && index <= completed + 1 && index !== current
        return (
          <li key={step.key} className={cn(styles.step, styles[`step-${state}`])}>
            <button type="button" disabled={!clickable} onClick={() => onSelect?.(index)} className={styles.stepButton}>
              <span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span>
              <span className={styles.stepTitle}>{step.title}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export function Table({ children, dense, elevated }: { children: ReactNode; dense?: boolean; elevated?: boolean }) {
  return (
    <div className={cn(styles.tableWrap, elevated && styles.tableElevated)}>
      <table className={cn(styles.table, dense && styles.tableDense)}>{children}</table>
    </div>
  )
}

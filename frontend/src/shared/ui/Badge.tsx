import type { ReactNode } from 'react'
import type { ApplicationStatus } from '@/api/types'
import { cn } from '@/shared/lib/cn'
import { statusMeta, type Tone } from '@/shared/lib/statusMeta'
import styles from './Badge.module.css'

export function Badge({
  tone = 'neutral',
  dot,
  pulse,
  children,
  className,
}: {
  tone?: Tone
  dot?: boolean
  pulse?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn(styles.badge, styles[tone], className)}>
      {dot && <i className={cn(styles.dot, pulse && styles.pulse)} aria-hidden />}
      {children}
    </span>
  )
}

export function StatusBadge({ status, className }: { status: ApplicationStatus; className?: string }) {
  const meta = statusMeta[status]
  return (
    <Badge tone={meta.tone} dot pulse={meta.tone === 'progress'} className={className}>
      {meta.title}
    </Badge>
  )
}

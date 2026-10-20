import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import styles from './Card.module.css'

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  padding?: 'none' | 'sm' | 'md' | 'lg'
  tone?: 'default' | 'plain' | 'muted' | 'accent' | 'dark'
  interactive?: boolean
  as?: 'section' | 'article' | 'div'
  assist?: string
}

export function Card({
  title,
  eyebrow,
  actions,
  padding = 'md',
  tone = 'default',
  interactive,
  as: Tag = 'section',
  assist,
  className,
  children,
  ...rest
}: CardProps) {
  const hasHeader = Boolean(title || eyebrow || actions)
  const rail = hasHeader && tone === 'default'
  return (
    <Tag
      className={cn(
        styles.card,
        styles[`pad-${padding}`],
        styles[tone],
        rail && styles.railContainer,
        interactive && styles.interactive,
        className,
      )}
      data-assist={assist}
      {...rest}
    >
      <div className={cn(styles.frame, rail && styles.rail)}>
        {hasHeader && (
          <header className={styles.header}>
            <div className={styles.titles}>
              {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
              {title && <h3 className={styles.title}>{title}</h3>}
            </div>
            {actions && <div className={styles.actions}>{actions}</div>}
          </header>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </Tag>
  )
}

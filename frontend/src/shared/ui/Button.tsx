import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '@/shared/lib/cn'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  iconRight?: ReactNode
  block?: boolean
  loading?: boolean
}

export type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>

function classes({ variant = 'primary', size = 'md', block }: CommonProps, className?: string) {
  return cn(styles.button, styles[variant], styles[size], block && styles.block, className)
}

export function Button({ variant, size, icon, iconRight, block, loading, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={classes({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden /> : icon}
      {children !== undefined && <span className={styles.label}>{children}</span>}
      {iconRight}
    </button>
  )
}

export type ButtonLinkProps = CommonProps & LinkProps

export function ButtonLink({ variant, size, icon, iconRight, block, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classes({ variant, size, block }, className)} {...rest}>
      {icon}
      {children !== undefined && <span className={styles.label}>{children}</span>}
      {iconRight}
    </Link>
  )
}

export function IconButton({
  label,
  className,
  children,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(styles.iconButton, active && styles.iconActive, className)}
      {...rest}
    >
      {children}
    </button>
  )
}

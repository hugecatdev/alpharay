import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import styles from './Logo.module.css'

export function Logo({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span className={cn(styles.logo, styles[size], className)} aria-label="AlphaRay">
      AlphaRay
      <ArrowUpRight className={styles.arrow} strokeWidth={2.8} aria-hidden />
    </span>
  )
}

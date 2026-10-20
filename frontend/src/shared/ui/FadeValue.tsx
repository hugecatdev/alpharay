import type { ReactNode } from 'react'
import styles from './FadeValue.module.css'

export function FadeValue({ value, children }: { value: string | number; children?: ReactNode }) {
  return (
    <span key={value} className={styles.fade}>
      {children ?? value}
    </span>
  )
}

import type { ReactNode } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { useAssistant } from './AssistantProvider'
import styles from './AskButton.module.css'

interface AskButtonProps {
  question: string
  label?: string
  variant?: 'icon' | 'text' | 'chip'
  children?: ReactNode
  className?: string
}

export function AskButton({ question, label = 'Спросить Рэя', variant = 'icon', children, className }: AskButtonProps) {
  const { enabled, ask } = useAssistant()
  if (!enabled) return null

  if (variant === 'icon') {
    return (
      <button
        type="button"
        className={cn(styles.icon, className)}
        onClick={() => ask(question)}
        aria-label={`${label}: ${question}`}
        title={label}
      >
        ?
      </button>
    )
  }

  return (
    <button type="button" className={cn(variant === 'chip' ? styles.chip : styles.text, className)} onClick={() => ask(question)}>
      <MessageCircleQuestion size={16} aria-hidden />
      <span>{children ?? label}</span>
    </button>
  )
}

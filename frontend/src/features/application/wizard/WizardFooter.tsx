import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/shared/ui'
import styles from './WizardFooter.module.css'

interface WizardFooterProps {
  onBack?: () => void
  onNext?: () => void
  nextLabel?: string
  nextIcon?: ReactNode
  nextDisabled?: boolean
  loading?: boolean
  hint?: ReactNode
  assist?: string
  nextType?: 'button' | 'submit'
  form?: string
}

export function WizardFooter({
  onBack,
  onNext,
  nextLabel = 'Далее',
  nextIcon,
  nextDisabled,
  loading,
  hint,
  assist,
  nextType = 'button',
  form,
}: WizardFooterProps) {
  return (
    <div className={styles.footer}>
      {onBack ? (
        <Button variant="secondary" icon={<ArrowLeft size={17} />} onClick={onBack} disabled={loading}>
          Назад
        </Button>
      ) : (
        <span />
      )}
      {hint ? <span className={styles.hint}>{hint}</span> : <span className={styles.spacer} />}
      <Button
        type={nextType}
        form={form}
        size="lg"
        onClick={onNext}
        disabled={nextDisabled}
        loading={loading}
        iconRight={nextIcon ?? <ArrowRight size={18} />}
        data-assist={assist}
      >
        {nextLabel}
      </Button>
    </div>
  )
}

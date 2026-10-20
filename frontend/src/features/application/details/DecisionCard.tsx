import { Bot, UserRoundCheck } from 'lucide-react'
import type { Decision } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { formatDateTime } from '@/shared/lib/dates'
import { Card } from '@/shared/ui'
import { decisionTypeLabels, madeByLabel } from './format'
import styles from './DecisionCard.module.css'

export function DecisionCard({ decision }: { decision: Decision }) {
  const automatic = !decision.made_by || decision.made_by === 'SYSTEM'
  return (
    <Card
      eyebrow="Решение банка"
      title={decisionTypeLabels[decision.type]}
      actions={<AskButton question="Почему банк принял такое решение и на что оно опиралось?" />}
      assist="decision-reasons"
    >
      <div className={styles.meta}>
        <span className={styles.by}>
          {automatic ? <Bot size={15} /> : <UserRoundCheck size={15} />}
          {madeByLabel(decision.made_by)}
        </span>
        <span>{formatDateTime(decision.created_at)}</span>
      </div>
      {decision.reasons.length > 0 && (
        <ul className={styles.reasons}>
          {decision.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

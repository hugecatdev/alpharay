import { Check, X } from 'lucide-react'
import type { ApplicationStatus } from '@/api'
import { cn } from '@/shared/lib/cn'
import { TIMELINE, timelineIndex } from '@/shared/lib/statusMeta'
import styles from './Timeline.module.css'

type StageState = 'done' | 'current' | 'failed' | 'todo' | 'cut'
type StageTone = 'progress' | 'warning' | 'info' | 'accent' | 'success'

interface StageView {
  state: StageState
  tone: StageTone
}

const DECISION_INDEX = TIMELINE.findIndex((stage) => stage.key === 'decision')
const SIGNING_INDEX = TIMELINE.findIndex((stage) => stage.key === 'signing')
const PAYOUT_INDEX = TIMELINE.findIndex((stage) => stage.key === 'disbursed')

function toneFor(status: ApplicationStatus): StageTone {
  switch (status) {
    case 'NEED_INFO':
      return 'warning'
    case 'MANUAL_REVIEW':
      return 'info'
    case 'COUNTER_OFFER':
    case 'SIGNING':
      return 'accent'
    case 'APPROVED':
      return 'success'
    default:
      return 'progress'
  }
}

function buildStages(status: ApplicationStatus, previousStatus: ApplicationStatus | null): StageView[] {
  let currentIndex: number
  let failed = false
  let allDone = false

  if (status === 'DISBURSED') {
    allDone = true
    currentIndex = PAYOUT_INDEX
  } else if (status === 'SIGNED') {
    currentIndex = PAYOUT_INDEX
  } else if (status === 'APPROVED' || status === 'SIGNING') {
    currentIndex = SIGNING_INDEX
  } else if (status === 'REJECTED' || status === 'CLIENT_DECLINED') {
    currentIndex = DECISION_INDEX
    failed = true
  } else if (status === 'CANCELLED') {
    const fromIndex = previousStatus ? timelineIndex(previousStatus) : -1
    currentIndex = fromIndex >= 0 ? fromIndex : 0
    if (previousStatus === 'APPROVED') currentIndex = SIGNING_INDEX
    failed = true
  } else {
    currentIndex = Math.max(0, timelineIndex(status))
  }

  return TIMELINE.map((_, index) => {
    if (allDone || index < currentIndex) return { state: 'done', tone: 'success' }
    if (index === currentIndex) {
      if (failed) return { state: 'failed', tone: 'accent' }
      return { state: 'current', tone: toneFor(status) }
    }
    return { state: failed ? 'cut' : 'todo', tone: 'progress' }
  })
}

export function Timeline({ status, previousStatus = null }: { status: ApplicationStatus; previousStatus?: ApplicationStatus | null }) {
  const stages = buildStages(status, previousStatus)
  return (
    <ol className={styles.timeline} data-assist="timeline" aria-label="Этапы рассмотрения заявки">
      {TIMELINE.map((stage, index) => {
        const view = stages[index]
        const next = stages[index + 1]
        return (
          <li
            key={stage.key}
            className={cn(styles.stage, styles[view.state], styles[`tone-${view.tone}`])}
            aria-current={view.state === 'current' ? 'step' : undefined}
          >
            {index < TIMELINE.length - 1 && (
              <span
                className={cn(
                  styles.connector,
                  view.state === 'done' && next?.state !== 'todo' && next?.state !== 'cut' && styles.connectorDone,
                  view.state === 'done' && next?.state === 'current' && styles.connectorActive,
                  (view.state === 'failed' || view.state === 'cut') && styles.connectorCut,
                )}
                aria-hidden
              />
            )}
            <span className={styles.marker} aria-hidden>
              {view.state === 'done' && <Check size={18} strokeWidth={3} />}
              {view.state === 'failed' && <X size={18} strokeWidth={3} />}
              {view.state === 'current' && <i className={styles.core} />}
            </span>
            <span className={styles.title}>{stage.title}</span>
          </li>
        )
      })}
    </ol>
  )
}

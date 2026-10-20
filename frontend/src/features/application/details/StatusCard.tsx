import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, FilePen, FileText, Loader, RefreshCw, XCircle } from 'lucide-react'
import type { Application } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { isProcessing, statusMeta, TIMELINE, timelineIndex, type Tone } from '@/shared/lib/statusMeta'
import { Card } from '@/shared/ui'
import styles from './StatusCard.module.css'

const toneIcons: Record<Tone, ReactNode> = {
  neutral: <FileText size={24} />,
  info: <Clock3 size={24} />,
  progress: <Loader size={24} />,
  success: <CheckCircle2 size={24} />,
  warning: <AlertTriangle size={24} />,
  danger: <XCircle size={24} />,
  accent: <FilePen size={24} />,
}

export function StatusCard({ application }: { application: Application }) {
  const meta = statusMeta[application.status]
  const processing = isProcessing(application.status) || application.status === 'SIGNED'
  const stageIndex = timelineIndex(application.status)
  const automatic = processing && application.status !== 'MANUAL_REVIEW'

  return (
    <Card tone="plain" className={cn(styles.card, styles[meta.tone])} assist="status">
      <span className={cn(styles.icon, meta.tone === 'progress' && styles.spinning)} aria-hidden>
        {toneIcons[meta.tone]}
      </span>
      <div className={styles.body}>
        <div className={styles.head}>
          <span className={styles.eyebrow}>Что происходит</span>
          <AskButton question={`Что означает статус «${meta.title}» и что будет дальше?`} />
        </div>
        <h2 className={styles.title}>{meta.title}</h2>
        <p className={styles.description}>{meta.description}</p>
        <div className={styles.chips}>
          {automatic && (
            <span className={styles.live}>
              <i className={styles.liveDot} aria-hidden />
              Обновляется автоматически
            </span>
          )}
          {processing && stageIndex >= 0 && (
            <span className={styles.chip}>
              <RefreshCw size={13} />
              Этап {stageIndex + 1} из {TIMELINE.length}: {TIMELINE[stageIndex].title}
            </span>
          )}
          {application.status === 'MANUAL_REVIEW' && (
            <span className={styles.chip}>
              <Clock3 size={13} />
              Обычно занимает до 1 рабочего дня
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

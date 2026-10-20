import { ShieldAlert } from 'lucide-react'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { formatMoney, formatPercent } from '@/shared/lib/money'
import { formatShare, type LoanMetrics } from './metrics'
import styles from './RiskWarning.module.css'

const leads: Record<LoanMetrics['riskLevel'], string> = {
  low: 'Нагрузка выглядит посильной, но платить придётся каждый месяц — даже если выручка временно снизится.',
  medium: 'Платёж заметно нагрузит бизнес. Оцените, хватит ли денег в слабые месяцы, и держите резерв.',
  high: 'Платёж забирает большую часть свободных денег бизнеса. Высокий риск не справиться с выплатами — подумайте о меньшей сумме или более долгом сроке.',
}

function toneOf(share: number | null): 'good' | 'mid' | 'bad' | undefined {
  if (share === null) return undefined
  return share < 0.4 ? 'good' : share < 0.7 ? 'mid' : 'bad'
}

export function RiskWarning({ metrics }: { metrics: LoanMetrics }) {
  const { riskLevel } = metrics
  const share =
    metrics.share === null ? null : metrics.share >= 1 ? 'больше 100%' : formatShare(metrics.share)
  const afterDrop =
    metrics.shareAfterDrop === null ? null : metrics.shareAfterDrop >= 1 ? 'не хватит' : formatShare(metrics.shareAfterDrop)
  return (
    <section className={cn(styles.warning, styles[riskLevel])} data-assist="risk-warning" role="note" aria-label="Предупреждение о рисках">
      <span className={styles.eyebrow}>
        <ShieldAlert size={18} aria-hidden />
        Важно перед оформлением
      </span>
      <h3 className={styles.title}>Кредит — это обязательство, а не дополнительная выручка</h3>
      <p className={styles.lead}>{leads[riskLevel]}</p>

      <div className={styles.facts}>
        <div>
          <strong className="tabular">{formatMoney(metrics.overpayment)}</strong>
          <span>переплата за весь срок — {formatPercent(metrics.overpaymentShare * 100)} от суммы</span>
        </div>
        <div>
          <strong className={cn('tabular', styles[toneOf(metrics.share) ?? 'neutral'])}>{share ?? '—'}</strong>
          <span>
            {metrics.avgFcf !== null
              ? `свободного потока уйдёт на платёж (${formatMoney(Math.max(0, metrics.avgFcf))} в мес.)`
              : 'нет оборотов по счёту — сравните платёж с прибылью сами'}
          </span>
        </div>
        {afterDrop && (
          <div>
            <strong className={cn('tabular', styles[toneOf(metrics.shareAfterDrop) ?? 'neutral'])}>{afterDrop}</strong>
            <span>{afterDrop === 'не хватит' ? 'свободного потока, если выручка упадёт на 20%' : 'нагрузка, если выручка упадёт на 20%'}</span>
          </div>
        )}
      </div>

      <p className={styles.footnote}>
        При просрочке начисляются пени, информация попадает в кредитную историю, и следующие кредиты станут дороже или недоступны.
      </p>
      <div className={styles.actions}>
        <AskButton variant="text" className={styles.ask} question="Какие риски у этого кредита для моего бизнеса?">
          Спросить Рэя о рисках
        </AskButton>
        <AskButton variant="chip" className={styles.askChip} question="Что будет, если я не смогу платить?">
          Что будет, если я не смогу платить?
        </AskButton>
      </div>
    </section>
  )
}

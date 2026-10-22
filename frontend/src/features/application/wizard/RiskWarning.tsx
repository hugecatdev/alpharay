import { ShieldAlert } from 'lucide-react'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { formatMoney, formatPercent } from '@/shared/lib/money'
import { COMFORT_LOAD, HIGH_LOAD, formatShare, type LoanMetrics } from './metrics'
import styles from './RiskWarning.module.css'

const leads: Record<LoanMetrics['riskLevel'], string> = {
  low: 'Нагрузка выглядит посильной, но платить придётся каждый месяц — даже если выручка временно снизится.',
  medium: 'Платёж заметно нагрузит бизнес. Оцените, хватит ли денег в слабые месяцы, и держите резерв.',
  high: 'Платёж забирает большую часть свободных денег бизнеса. Высокий риск не справиться с выплатами — подумайте о меньшей сумме или более долгом сроке.',
}

function toneOf(share: number | null): 'good' | 'mid' | 'bad' | undefined {
  if (share === null) return undefined
  return share <= COMFORT_LOAD ? 'good' : share <= HIGH_LOAD ? 'mid' : 'bad'
}

function reserveTone(reserve: number): 'good' | 'mid' | 'bad' {
  return reserve >= 0.2 ? 'good' : reserve >= 0.1 ? 'mid' : 'bad'
}

export function RiskWarning({ metrics }: { metrics: LoanMetrics }) {
  const { riskLevel, reserve } = metrics
  const share = metrics.share === null ? null : formatShare(metrics.share)
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
          {metrics.revolving ? (
            <>
              <strong className="tabular">{formatMoney(metrics.monthly)}</strong>
              <span>процентов в месяц, если использовать весь лимит; без использования — 0 ₽</span>
            </>
          ) : (
            <>
              <strong className="tabular">{formatMoney(metrics.overpayment)}</strong>
              <span>переплата за весь срок — {formatPercent(metrics.overpaymentShare * 100)} от суммы</span>
            </>
          )}
        </div>
        <div>
          <strong className={cn('tabular', styles[toneOf(metrics.share) ?? 'neutral'])}>{share ?? '—'}</strong>
          <span>
            {metrics.flow !== null
              ? `денежного потока уйдёт на все кредиты${metrics.existing > 0 ? ', включая текущие' : ''} (поток ${formatMoney(Math.max(0, metrics.flow))} в мес.)`
              : 'нет оборотов по счёту — сравните платёж с прибылью сами'}
          </span>
        </div>
        {reserve !== null && (
          <div>
            <strong className={cn('tabular', styles[reserveTone(reserve)])}>
              {reserve > 0 ? formatPercent(reserve * 100) : 'нет запаса'}
            </strong>
            <span>
              {reserve > 0
                ? 'на столько может упасть выручка, прежде чем поток перестанет покрывать новый платёж'
                : 'уже сейчас средний поток не покрывает новый платёж'}
            </span>
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

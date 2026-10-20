import { AlertTriangle, Gauge, Sparkles } from 'lucide-react'
import type { Recommendation, Scoring } from '@/api'
import { cn } from '@/shared/lib/cn'
import { formatTerm } from '@/shared/lib/dates'
import { gradeTone } from '@/shared/lib/labels'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { Badge, Card, EmptyState, ProgressBar } from '@/shared/ui'
import { decisionTone, gradeBarTone, gradeDescription, recommendationLabels } from './bankLabels'
import styles from './ScoringPanel.module.css'

function factorTone(points: number, max: number): 'good' | 'mid' | 'bad' {
  const ratio = max > 0 ? points / max : 0
  if (ratio >= 0.7) return 'good'
  if (ratio >= 0.4) return 'mid'
  return 'bad'
}

export function ScoringPanel({ scoring }: { scoring: Scoring | null }) {
  if (!scoring) {
    return (
      <Card title="Скоринг" padding="md">
        <EmptyState icon={<Gauge size={22} />} title="Скоринг ещё не рассчитан">
          Оценка появится, когда конвейер завершит обогащение данных.
        </EmptyState>
      </Card>
    )
  }

  const factorsMax = scoring.factors.reduce((sum, factor) => sum + factor.max_points, 0)
  const max = factorsMax > 0 ? factorsMax : 100

  return (
    <Card title="Скоринг" eyebrow={`Модель ${scoring.model_version}`} padding="md" className={styles.card}>
      <div className={styles.scoreRow}>
        <div className={styles.score}>
          <strong className="tabular">{scoring.score}</strong>
          <span>из {max}</span>
        </div>
        <div className={styles.grade}>
          <Badge tone={gradeTone[scoring.grade]} className={styles.gradeBadge}>
            Грейд {scoring.grade}
          </Badge>
          <span>{gradeDescription[scoring.grade]}</span>
        </div>
      </div>
      <ProgressBar value={scoring.score} max={max} tone={gradeBarTone[scoring.grade]} height={8} label="Скоринговый балл" />

      {scoring.stop_factors.length > 0 && (
        <div className={styles.stops} role="alert">
          <strong>
            <AlertTriangle size={16} /> Стоп-факторы
          </strong>
          <ul>
            {scoring.stop_factors.map((factor) => (
              <li key={factor}>{factor}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.factors}>
        {scoring.factors.map((factor) => {
          const tone = factorTone(factor.points, factor.max_points)
          return (
            <div key={factor.code} className={styles.factor}>
              <div className={styles.factorHead}>
                <span className={styles.factorName}>{factor.name}</span>
                <span className={cn(styles.factorPoints, styles[tone], 'tabular')}>
                  {factor.points}/{factor.max_points}
                </span>
              </div>
              <div className={styles.factorBar}>
                <span
                  className={cn(styles.factorFill, styles[`fill-${tone}`])}
                  style={{ width: `${factor.max_points > 0 ? Math.max(0, (factor.points / factor.max_points) * 100) : 0}%` }}
                />
              </div>
              <div className={styles.factorMeta}>
                <span className={styles.factorValue}>{factor.value}</span>
                {factor.comment && <span className={styles.factorComment}>{factor.comment}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function RecommendationCard({ recommendation }: { recommendation: Recommendation | null }) {
  if (!recommendation) return null
  const terms = [
    recommendation.amount !== undefined ? formatMoney(recommendation.amount) : null,
    recommendation.term !== undefined ? formatTerm(recommendation.term) : null,
    recommendation.rate !== undefined ? formatRate(recommendation.rate) : null,
  ].filter((part): part is string => part !== null)

  return (
    <Card padding="md" tone="muted" className={styles.recommendation}>
      <div className={styles.recHead}>
        <span className={styles.recIcon}>
          <Sparkles size={16} />
        </span>
        <div className={styles.recTitles}>
          <span className={styles.recEyebrow}>Рекомендация системы</span>
          <Badge tone={decisionTone[recommendation.type]}>{recommendationLabels[recommendation.type]}</Badge>
        </div>
      </div>
      {terms.length > 0 && <p className={cn(styles.recTerms, 'tabular')}>{terms.join(' · ')}</p>}
      {recommendation.reasons.length > 0 && (
        <ul className={styles.recReasons}>
          {recommendation.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </Card>
  )
}

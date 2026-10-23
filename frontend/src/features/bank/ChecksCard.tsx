import type { BankApplication, CheckResult, CheckStatus, RevisionSummary } from '@/api'
import { formatDateTime } from '@/shared/lib/dates'
import { formatMoney } from '@/shared/lib/money'
import { Badge, Card } from '@/shared/ui'
import type { Tone } from '@/shared/lib/statusMeta'
import styles from './ChecksCard.module.css'

const statusLabels: Record<CheckStatus, string> = {
  OK: 'Без замечаний',
  ISSUES: 'Есть замечания',
  ERROR: 'Технический сбой',
}

const statusTone: Record<CheckStatus, Tone> = {
  OK: 'success',
  ISSUES: 'warning',
  ERROR: 'danger',
}

const revisionLabels: Record<RevisionSummary['reason'], string> = {
  SUBMITTED: 'Подача заявки',
  INFO_PROVIDED: 'Ответ на запрос банка',
}

function CheckRow({ check }: { check: CheckResult }) {
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        <strong>{check.source}</strong>
        <Badge tone={statusTone[check.status]}>{statusLabels[check.status]}</Badge>
      </div>
      <p className={styles.summary}>{check.summary}</p>
      <span className={styles.meta}>
        {formatDateTime(check.checked_at)}
        {check.attempt > 1 ? ` · попытка ${check.attempt}` : ''}
      </span>
    </li>
  )
}

function RevisionRow({ revision }: { revision: RevisionSummary }) {
  const revenue = revision.financials?.revenue_12m
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        <strong>
          Версия {revision.sequence} · {revisionLabels[revision.reason]}
        </strong>
        <span className={styles.meta}>{formatDateTime(revision.created_at)}</span>
      </div>
      <p className={styles.summary}>
        {formatMoney(revision.amount)} на {revision.term} мес.
        {revenue !== undefined ? ` · выручка за 12 мес. ${formatMoney(revenue)}` : ''} · {revision.author_name}
      </p>
      {revision.answers.length > 0 && (
        <ul className={styles.answers}>
          {revision.answers.map((answer) => (
            <li key={answer.code}>
              {answer.code}: {answer.value}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function ChecksCard({ application }: { application: BankApplication }) {
  if (!application.checks.length && !application.revisions.length) return null
  return (
    <Card title="Проверки и версии анкеты" padding="md">
      {application.checks.length > 0 && (
        <ul className={styles.list} aria-label="Результаты проверок">
          {application.checks.map((check, index) => (
            <CheckRow key={`${check.type}-${index}`} check={check} />
          ))}
        </ul>
      )}
      {application.revisions.length > 0 && (
        <ul className={styles.list} aria-label="Версии анкеты">
          {application.revisions.map((revision) => (
            <RevisionRow key={revision.sequence} revision={revision} />
          ))}
        </ul>
      )}
    </Card>
  )
}

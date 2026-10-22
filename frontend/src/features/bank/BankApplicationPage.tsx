import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, FileText, Gavel, UserCheck } from 'lucide-react'
import type { AppEvent, BankApplication } from '@/api'
import { useCurrentUser } from '@/features/auth/AuthProvider'
import { creditSummary } from '@/shared/lib/annuity'
import { formatDate, formatDateTime, formatTerm } from '@/shared/lib/dates'
import { documentKindLabels, purposeLabels } from '@/shared/lib/labels'
import { formatFileSize, formatMoney, formatRate } from '@/shared/lib/money'
import { isProcessing, statusMeta } from '@/shared/lib/statusMeta'
import { Alert, Badge, Button, Card, EmptyState, ErrorState, KeyValueList, PageLoader, StatusBadge } from '@/shared/ui'
import { decisionTone, decisionTypeLabels, madeByLabel } from './bankLabels'
import { DecisionForm } from './DecisionForm'
import { EnrichmentTabs } from './EnrichmentTabs'
import { FinancialsCard } from './FinancialsCard'
import { RecommendationCard, ScoringPanel } from './ScoringPanel'
import { isAssignedToMe, useAssign, useBankApplication, useBankEvents } from './useBank'
import styles from './BankApplicationPage.module.css'

interface HistoryEntry {
  date: string
  title: string
  detail?: string
}

function buildHistory(application: BankApplication): HistoryEntry[] {
  const entries: HistoryEntry[] = [{ date: application.created_at, title: 'Черновик создан клиентом' }]
  if (application.submitted_at) entries.push({ date: application.submitted_at, title: 'Заявка подана', detail: 'Передана в кредитный конвейер' })
  if (application.decision) {
    entries.push({
      date: application.decision.created_at,
      title: decisionTypeLabels[application.decision.type],
      detail: `${madeByLabel(application.decision.made_by)}${application.decision.reasons.length ? ` · ${application.decision.reasons.join('; ')}` : ''}`,
    })
  }
  if (application.info_request) {
    entries.push({
      date: application.decision?.created_at ?? application.updated_at,
      title: application.info_request.status === 'ANSWERED' ? 'Клиент ответил на запрос' : 'Запрос информации отправлен',
      detail: application.info_request.items.map((item) => item.label).join(', '),
    })
  }
  if (application.offer) {
    entries.push({
      date: application.decision?.created_at ?? application.updated_at,
      title: application.offer.is_counter ? 'Встречное предложение' : 'Предложение условий',
      detail: `${formatMoney(application.offer.amount)} · ${formatTerm(application.offer.term)} · ${formatRate(application.offer.rate)} · действует до ${formatDate(application.offer.valid_until)}`,
    })
  }
  if (application.contract?.signed_at) {
    entries.push({ date: application.contract.signed_at, title: 'Договор подписан', detail: `№ ${application.contract.number}` })
  }
  entries.push({ date: application.updated_at, title: `Текущий статус: ${statusMeta[application.status].title}` })
  return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

const actorLabels: Record<AppEvent['actor_type'], string> = {
  CLIENT: 'Клиент',
  SYSTEM: 'Система',
  UNDERWRITER: 'Андеррайтер',
}

function historyFromEvents(events: AppEvent[]): HistoryEntry[] {
  return events
    .map((event) => ({
      date: event.created_at,
      title:
        event.from_status && event.from_status !== event.to_status
          ? `${statusMeta[event.from_status].title} → ${statusMeta[event.to_status].title}`
          : statusMeta[event.to_status].title,
      detail: [`${actorLabels[event.actor_type]}: ${event.actor_name}`, event.reason].filter(Boolean).join(' · '),
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

function DecisionSummary({ application, justSent }: { application: BankApplication; justSent: boolean }) {
  const decision = application.decision
  return (
    <div className={styles.summary}>
      {justSent && (
        <Alert tone="success" title="Решение отправлено клиенту">
          Клиент получит уведомление в кабинете и увидит дальнейшие шаги.
        </Alert>
      )}
      {decision ? (
        <>
          <div className={styles.summaryHead}>
            <Badge tone={decisionTone[decision.type]}>{decisionTypeLabels[decision.type]}</Badge>
            <span className={styles.summaryMeta}>
              {madeByLabel(decision.made_by)} · {formatDateTime(decision.created_at)}
            </span>
          </div>
          {decision.reasons.length > 0 && (
            <ul className={styles.reasons}>
              {decision.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {application.offer && (
            <KeyValueList
              items={[
                { label: 'Сумма', value: formatMoney(application.offer.amount) },
                { label: 'Срок', value: formatTerm(application.offer.term) },
                { label: 'Ставка', value: formatRate(application.offer.rate) },
                { label: 'Платёж', value: formatMoney(application.offer.monthly_payment) },
              ]}
            />
          )}
          {application.info_request && (
            <ul className={styles.reasons}>
              {application.info_request.items.map((item) => (
                <li key={item.code}>{item.label}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className={styles.waiting}>
          {isProcessing(application.status)
            ? 'Заявка ещё проходит автоматический конвейер. Решение можно принять, когда она попадёт на ручное рассмотрение.'
            : `Статус заявки: ${statusMeta[application.status].title}.`}
        </p>
      )}
    </div>
  )
}

function Header({ application }: { application: BankApplication }) {
  const user = useCurrentUser()
  const assign = useAssign()
  const mine = isAssignedToMe(application.assigned_to, user)
  return (
    <header className={styles.header}>
      <Link to="/bank" className={styles.back}>
        <ArrowLeft size={16} /> К очереди
      </Link>
      <div className={styles.headRow}>
        <div className={styles.headMain}>
          <span className={styles.eyebrow}>Заявка {application.number}</span>
          <h1>{application.company.name}</h1>
          <p className={styles.headMeta}>
            {application.product.name} · <strong className="tabular">{formatMoney(application.amount)}</strong> на {formatTerm(application.term)} · ИНН{' '}
            {application.company.inn}
          </p>
        </div>
        <div className={styles.headSide}>
          <StatusBadge status={application.status} />
          {application.assigned_to ? (
            <span className={mine ? styles.mine : styles.assignee}>
              <UserCheck size={15} /> {mine ? 'В работе у вас' : `Назначено: ${application.assigned_to}`}
            </span>
          ) : (
            <Button size="sm" loading={assign.isPending} onClick={() => assign.mutate(application.id)}>
              Взять в работу
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}

export function BankApplicationPage() {
  const { id = '' } = useParams()
  const query = useBankApplication(id)
  const events = useBankEvents(id, query.data?.status)
  const [justSent, setJustSent] = useState(false)

  if (query.isLoading) return <PageLoader />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  const application = query.data
  if (!application) return <EmptyState title="Заявка не найдена" />

  const revolving = application.product.repayment === 'REVOLVING'
  const base = creditSummary(application.product.repayment, application.amount, application.term, application.product.base_rate)
  const canDecide = application.status === 'MANUAL_REVIEW'
  const history = events.data?.length ? historyFromEvents(events.data) : buildHistory(application)

  return (
    <div className={styles.page}>
      <Header application={application} />
      <div className={styles.columns}>
        <div className={styles.left}>
          <Card title="Параметры заявки" padding="md">
            <KeyValueList
              columns={2}
              items={[
                { label: 'Продукт', value: application.product.name },
                { label: 'Сумма', value: formatMoney(application.amount) },
                { label: 'Срок', value: formatTerm(application.term) },
                { label: 'Ставка продукта', value: formatRate(application.product.base_rate) },
                revolving
                  ? { label: 'Проценты при полном лимите', value: `${formatMoney(base.monthly_payment)} / мес` }
                  : { label: 'Платёж по базовой ставке', value: formatMoney(base.monthly_payment) },
                revolving
                  ? { label: 'Погашение', value: 'поступлениями, транш до 60 дней' }
                  : { label: 'Переплата', value: formatMoney(base.overpayment) },
                { label: 'Тип цели', value: application.purpose_type ? purposeLabels[application.purpose_type].title : '—' },
                { label: 'Подана', value: application.submitted_at ? formatDateTime(application.submitted_at) : 'Не подана' },
              ]}
            />
            {application.purpose && (
              <div className={styles.purpose}>
                <span>Цель со слов клиента</span>
                <p>{application.purpose}</p>
              </div>
            )}
          </Card>

          <EnrichmentTabs application={application} />
          <FinancialsCard application={application} />

          <Card title="Документы" padding="md">
            {application.documents.length ? (
              <ul className={styles.docs}>
                {application.documents.map((doc) => (
                  <li key={doc.id} className={styles.doc}>
                    <span className={styles.docIcon}>
                      <FileText size={16} />
                    </span>
                    <div className={styles.docText}>
                      <strong>{doc.filename}</strong>
                      <span>
                        {documentKindLabels[doc.kind]} · {formatFileSize(doc.size)} · {formatDate(doc.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.waiting}>Клиент не загружал документы.</p>
            )}
            {application.product.requires_invoice && !application.documents.some((doc) => doc.kind === 'EQUIPMENT_INVOICE') && (
              <Alert tone="warning" className={styles.docAlert}>
                Для продукта обязателен счёт на оборудование — его нет среди документов.
              </Alert>
            )}
          </Card>

          <Card title="История" padding="md">
            <ol className={styles.history}>
              {history.map((entry, index) => (
                <li key={`${entry.title}-${index}`} className={styles.historyItem}>
                  <span className={styles.historyDot} aria-hidden />
                  <div>
                    <div className={styles.historyHead}>
                      <strong>{entry.title}</strong>
                      <time className={styles.historyTime}>{formatDateTime(entry.date)}</time>
                    </div>
                    {entry.detail && <p className={styles.historyDetail}>{entry.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className={styles.right}>
          <Card
            title={canDecide ? 'Решение' : 'Решение принято'}
            padding="md"
            actions={canDecide ? <Gavel size={18} className={styles.gavel} /> : <CheckCircle2 size={18} className={styles.done} />}
          >
            {canDecide ? (
              <DecisionForm application={application} onDecided={() => setJustSent(true)} />
            ) : (
              <DecisionSummary application={application} justSent={justSent} />
            )}
          </Card>
          <RecommendationCard recommendation={application.recommendation} />
          <ScoringPanel scoring={application.scoring} />
        </aside>
      </div>
    </div>
  )
}

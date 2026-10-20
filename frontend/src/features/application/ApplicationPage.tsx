import { Navigate, useParams } from 'react-router-dom'
import type { Application, AssistantFieldValue } from '@/api'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { statusMeta } from '@/shared/lib/statusMeta'
import { Card, ErrorState, PageLoader } from '@/shared/ui'
import { ActionBlock } from './details/ActionBlock'
import { ApplicationHeader } from './details/ApplicationHeader'
import { DecisionCard } from './details/DecisionCard'
import { DetailsCard } from './details/DetailsCard'
import { EventsList } from './details/EventsList'
import { StatusCard } from './details/StatusCard'
import { Timeline } from './details/Timeline'
import { shouldPoll, useApplication, useApplicationEvents } from './details/useApplication'
import styles from './ApplicationPage.module.css'

function screenData(application: Application | undefined): Record<string, AssistantFieldValue> {
  if (!application) return {}
  const { offer, decision, info_request: infoRequest } = application
  return {
    status: application.status,
    status_title: statusMeta[application.status].title,
    number: application.number,
    amount: application.amount,
    term: application.term,
    decision_type: decision?.type ?? null,
    reasons: decision?.reasons.join('; ') ?? null,
    offer_amount: offer?.amount ?? null,
    offer_term: offer?.term ?? null,
    offer_rate: offer?.rate ?? null,
    offer_monthly_payment: offer?.monthly_payment ?? null,
    requested_amount: offer?.requested.amount ?? null,
    requested_term: offer?.requested.term ?? null,
    info_items: infoRequest?.status === 'OPEN' ? infoRequest.items.map((item) => item.label).join('; ') : null,
  }
}

const SUGGESTIONS: Partial<Record<Application['status'], string[]>> = {
  NEED_INFO: ['Зачем банку эти данные?', 'Где взять выписку по счёту?', 'Что будет после отправки?'],
  COUNTER_OFFER: ['Почему условия изменились?', 'Стоит ли принимать предложение?', 'Сколько я переплачу?'],
  APPROVED: ['Что дальше?', 'Сколько я переплачу?', 'Можно ли погасить досрочно?'],
  REJECTED: ['Почему отказали?', 'Что улучшить?', 'Какой продукт подойдёт?'],
  DISBURSED: ['Когда первый платёж?', 'Из чего складывается платёж?', 'Можно ли погасить досрочно?'],
  MANUAL_REVIEW: ['Что проверяет специалист?', 'Сколько ждать?', 'Что означает мой статус?'],
}

export function ApplicationPage() {
  const { id = '' } = useParams()
  const query = useApplication(id)
  const application = query.data
  const poll = shouldPoll(application?.status)
  const events = useApplicationEvents(id, poll)

  useAssistantScreen({
    screen: 'application',
    title: application ? `Заявка ${application.number}` : 'Заявка',
    applicationId: id || null,
    data: screenData(application),
    suggestions: application ? SUGGESTIONS[application.status] : undefined,
  })

  if (query.isPending) return <PageLoader label="Загружаем заявку…" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!application) return null
  if (application.status === 'DRAFT') return <Navigate to={`/app/applications/${application.id}/edit?step=amount`} replace />

  const cancelledFrom =
    application.status === 'CANCELLED'
      ? ([...(events.data ?? [])].reverse().find((event) => event.to_status === 'CANCELLED')?.from_status ?? null)
      : null
  const showDecision = application.decision && application.status !== 'REJECTED'

  return (
    <div className={styles.page}>
      <ApplicationHeader application={application} />
      <Card tone="plain" className={styles.timelineCard}>
        <Timeline status={application.status} previousStatus={cancelledFrom} />
      </Card>
      <StatusCard application={application} />
      <ActionBlock application={application} />
      {showDecision && application.decision && <DecisionCard decision={application.decision} />}
      <div className={styles.columns}>
        <DetailsCard application={application} />
        <EventsList events={events.data} loading={events.isPending} />
      </div>
    </div>
  )
}

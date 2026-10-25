import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Coffee,
  FilePlus2,
  FileSignature,
  FlaskConical,
  Hourglass,
  PartyPopper,
  RefreshCcw,
  RotateCcw,
  TimerOff,
} from 'lucide-react'
import { applicationsApi, queryKeys, type Application } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { creditSummary } from '@/shared/lib/annuity'
import { formatDate, formatTerm } from '@/shared/lib/dates'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { Alert, Button, ButtonLink, Card, KeyValueList, Spinner } from '@/shared/ui'
import { CounterOfferBlock } from './CounterOfferBlock'
import { NeedInfoForm } from './NeedInfoForm'
import { ScheduleTable } from './ScheduleTable'
import { useApplicationCache } from './useApplication'
import styles from './ActionBlock.module.css'

function Quiet({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className={styles.quiet}>
      <span className={styles.quietIcon}>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  )
}

function SimulatedNote({ children }: { children: ReactNode }) {
  return (
    <Alert tone="neutral" icon={<FlaskConical size={18} />} title="Демо-режим">
      {children}
    </Alert>
  )
}

function ResubmitButton({ application }: { application: Application }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const resubmit = useMutation({
    mutationFn: () => applicationsApi.resubmit(application.id),
    onSuccess: (draft) => {
      queryClient.setQueryData(queryKeys.application(draft.id), draft)
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications, exact: true })
      navigate(`/app/applications/${draft.id}/edit?step=amount`)
    },
  })
  return (
    <>
      <Button variant="secondary" loading={resubmit.isPending} icon={<RotateCcw size={16} />} onClick={() => resubmit.mutate()}>
        Подать повторно
      </Button>
      {resubmit.isError && (
        <Alert tone="danger" title="Не получилось создать заявку">
          {resubmit.error.message}
        </Alert>
      )}
    </>
  )
}

function OfferDecision({ application }: { application: Application }) {
  const [confirmDecline, setConfirmDecline] = useState(false)
  const updateCache = useApplicationCache(application.id)
  const accept = useMutation({
    mutationFn: () => applicationsApi.acceptOffer(application.id, application.offer?.id),
    onSuccess: updateCache,
  })
  const decline = useMutation({ mutationFn: () => applicationsApi.declineOffer(application.id), onSuccess: updateCache })
  const failed = accept.error ?? decline.error
  return (
    <>
      {failed && (
        <Alert tone="danger" title="Не получилось сохранить решение">
          {failed.message}
        </Alert>
      )}
      <div className={styles.row}>
        {confirmDecline ? (
          <div className={styles.actions}>
            <span>Отклонить предложение? Заявка будет закрыта, но её можно будет подать повторно.</span>
            <Button variant="danger" loading={decline.isPending} onClick={() => decline.mutate()}>
              Да, отклонить
            </Button>
            <Button variant="ghost" disabled={decline.isPending} onClick={() => setConfirmDecline(false)}>
              Вернуться
            </Button>
          </div>
        ) : (
          <div className={styles.actions} data-assist="offer-decision">
            <Button size="lg" loading={accept.isPending} disabled={decline.isPending} icon={<Check size={18} />} onClick={() => accept.mutate()}>
              Принять условия
            </Button>
            <Button variant="ghost" disabled={accept.isPending} onClick={() => setConfirmDecline(true)}>
              Отклонить
            </Button>
          </div>
        )}
        <AskButton variant="text" question="Объясни простыми словами условия одобренного кредита: что я буду платить и чем рискую?">
          Разобраться в условиях
        </AskButton>
      </div>
    </>
  )
}

function ApprovedBlock({ application }: { application: Application }) {
  const offer = application.offer
  const amount = offer?.amount ?? application.amount
  const term = offer?.term ?? application.term
  const rate = offer?.rate ?? application.product.base_rate
  const revolving = application.product.repayment === 'REVOLVING'
  const summary = creditSummary(application.product.repayment, amount, term, rate)
  const monthly = offer?.monthly_payment ?? summary.monthly_payment
  const overpayment = summary.overpayment

  return (
    <div className={styles.approved}>
      <div className={styles.approvedHero}>
        <span className={styles.approvedLabel}>{revolving ? 'Проценты в месяц при полном использовании' : 'Платёж в месяц'}</span>
        <strong className={styles.approvedValue}>{formatMoney(monthly)}</strong>
        <span className={styles.approvedSub}>
          {revolving
            ? `Лимит ${formatMoney(amount)} на ${formatTerm(term)} под ${formatRate(rate)} — только на использованную сумму`
            : `${formatMoney(amount)} на ${formatTerm(term)} под ${formatRate(rate)}`}
        </span>
      </div>
      <KeyValueList
        columns={2}
        items={
          revolving
            ? [
                { label: 'Лимит', value: formatMoney(amount) },
                { label: 'Срок действия', value: formatTerm(term) },
                { label: 'Ставка', value: formatRate(rate) },
                { label: 'Погашение', value: 'поступлениями на счёт' },
                { label: 'Каждый транш', value: 'до 60 дней' },
                { label: 'Действует до', value: offer ? formatDate(offer.valid_until) : '—' },
              ]
            : [
                { label: 'Сумма', value: formatMoney(amount) },
                { label: 'Срок', value: formatTerm(term) },
                { label: 'Ставка', value: formatRate(rate) },
                { label: 'Переплата', value: formatMoney(overpayment) },
                { label: 'Всего к возврату', value: formatMoney(summary.total_payment) },
                { label: 'Действует до', value: offer ? formatDate(offer.valid_until) : '—' },
              ]
        }
      />
      <OfferDecision application={application} />
    </div>
  )
}

function RejectedBlock({ application }: { application: Application }) {
  const reasons = application.decision?.reasons ?? []
  return (
    <div className={styles.rejected}>
      <p className={styles.lead}>
        Сейчас банк не может выдать кредит на этих условиях. Это решение по конкретной заявке — когда ситуация изменится,
        можно подать новую или выбрать другой продукт.
      </p>
      {reasons.length > 0 && (
        <div className={styles.reasons} data-assist="decision-reasons">
          <span className={styles.reasonsTitle}>Причины</span>
          <ul>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.row}>
        <div className={styles.actions}>
          <ResubmitButton application={application} />
          <ButtonLink to="/app/applications/new" variant="ghost" iconRight={<ArrowUpRight size={16} />}>
            Другой продукт
          </ButtonLink>
        </div>
        <AskButton variant="text" question="Почему мне отказали и что можно улучшить, чтобы в следующий раз одобрили?">
          Что можно улучшить?
        </AskButton>
      </div>
    </div>
  )
}

function titleFor(application: Application): string {
  switch (application.status) {
    case 'DISBURSED':
      return 'Средства зачислены'
    case 'REJECTED':
      return 'Решение банка'
    case 'CLIENT_DECLINED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'Заявка закрыта'
    default:
      return 'Что требуется от вас'
  }
}

function Content({ application }: { application: Application }) {
  switch (application.status) {
    case 'NEED_INFO':
      return application.info_request ? (
        <NeedInfoForm application={application} request={application.info_request} />
      ) : (
        <Alert tone="warning" title="Банк запросил дополнительные данные">
          Список запрошенных документов появится здесь через несколько секунд.
        </Alert>
      )
    case 'COUNTER_OFFER':
      return application.offer ? (
        <CounterOfferBlock application={application} offer={application.offer} />
      ) : (
        <Alert tone="info">Условия предложения загружаются.</Alert>
      )
    case 'APPROVED':
      return <ApprovedBlock application={application} />
    case 'OFFER_ACCEPTED':
      return (
        <div className={styles.row}>
          <Quiet icon={<CheckCircle2 size={20} />} title="Условия приняты">
            Договор сформирован по принятым условиям. Осталось его подписать — это займёт меньше минуты.
          </Quiet>
          <ButtonLink to={`/app/applications/${application.id}/sign`} iconRight={<FileSignature size={16} />}>
            Перейти к подписанию
          </ButtonLink>
        </div>
      )
    case 'SIGNING':
      return (
        <div className={styles.row}>
          <Quiet icon={<FileSignature size={20} />} title="Договор ждёт подписи">
            Осталось подписать договор квалифицированной электронной подписью руководителя или кодом из кабинета — это
            займёт меньше минуты.
          </Quiet>
          <ButtonLink to={`/app/applications/${application.id}/sign`} iconRight={<ArrowUpRight size={16} />}>
            Подписать договор
          </ButtonLink>
        </div>
      )
    case 'SIGNED':
      return (
        <Quiet icon={<Spinner size={20} />} title="Ожидайте зачисления">
          Договор подписан. Деньги поступят на расчётный счёт в течение нескольких секунд.
        </Quiet>
      )
    case 'DISBURSED':
      return (
        <div className={styles.disbursed}>
          <Quiet icon={<PartyPopper size={20} />} title={`${formatMoney(application.disbursement?.amount ?? application.amount)} на расчётном счёте`}>
            {application.contract ? `Договор № ${application.contract.number}. ` : ''}Ниже — график платежей.
          </Quiet>
          {application.disbursement && (
            <SimulatedNote>
              Выдача смоделирована: операция {application.disbursement.operation_number} от{' '}
              {formatDate(application.disbursement.disbursed_at)} на счёт ••••{application.disbursement.account_number.slice(-4)}.
              Реальный платёж не проводился.
            </SimulatedNote>
          )}
          <ScheduleTable application={application} />
        </div>
      )
    case 'REJECTED':
      return <RejectedBlock application={application} />
    case 'CLIENT_DECLINED':
    case 'CANCELLED':
    case 'EXPIRED':
      return (
        <div className={styles.row}>
          <Quiet
            icon={application.status === 'EXPIRED' ? <TimerOff size={20} /> : <CheckCircle2 size={20} />}
            title={
              application.status === 'EXPIRED'
                ? 'Срок предложения истёк'
                : application.status === 'CANCELLED'
                  ? 'Заявка отменена'
                  : 'Вы отклонили предложение'
            }
          >
            {application.status === 'EXPIRED'
              ? 'Условия не были приняты вовремя. Подайте заявку повторно — банк рассчитает условия заново.'
              : 'Подать новую заявку можно в любой момент — данные компании уже сохранены.'}
          </Quiet>
          <div className={styles.actions}>
            <ResubmitButton application={application} />
            <ButtonLink to="/app/applications/new" variant="ghost" icon={<FilePlus2 size={16} />}>
              Новая заявка
            </ButtonLink>
          </div>
        </div>
      )
    case 'MANUAL_REVIEW':
      return (
        <Quiet icon={<Coffee size={20} />} title="Действий не требуется">
          Специалист изучает заявку. Если понадобятся данные — запрос появится здесь и в уведомлениях.
        </Quiet>
      )
    default:
      return (
        <Quiet icon={application.status === 'SUBMITTED' ? <Hourglass size={20} /> : <RefreshCcw size={20} />} title="Пока ничего">
          Банк проверяет заявку автоматически. Страница обновится сама, как только появится результат.
        </Quiet>
      )
  }
}

export function ActionBlock({ application }: { application: Application }) {
  return (
    <Card title={titleFor(application)} padding="lg" assist="action-block">
      <Content application={application} />
    </Card>
  )
}

import type { ReactNode } from 'react'
import { ArrowUpRight, CheckCircle2, Coffee, FilePlus2, FileSignature, Hourglass, PartyPopper, RefreshCcw } from 'lucide-react'
import type { Application } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { creditSummary } from '@/shared/lib/annuity'
import { formatDate, formatTerm } from '@/shared/lib/dates'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { Alert, ButtonLink, Card, KeyValueList, Spinner } from '@/shared/ui'
import { CounterOfferBlock } from './CounterOfferBlock'
import { NeedInfoForm } from './NeedInfoForm'
import { ScheduleTable } from './ScheduleTable'
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

function ApprovedBlock({ application }: { application: Application }) {
  const offer = application.offer
  const amount = offer?.amount ?? application.amount
  const term = offer?.term ?? application.term
  const rate = offer?.rate ?? application.product.base_rate
  const revolving = application.product.repayment === 'REVOLVING'
  const summary = creditSummary(application.product.repayment, amount, term, rate)
  const monthly = offer?.monthly_payment ?? summary.monthly_payment
  const overpayment = revolving ? summary.overpayment : Math.max(0, Math.round(monthly * term - amount))

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
                { label: 'Всего к возврату', value: formatMoney(monthly * term) },
                { label: 'Действует до', value: offer ? formatDate(offer.valid_until) : '—' },
              ]
        }
      />
      <div className={styles.row}>
        <ButtonLink to={`/app/applications/${application.id}/sign`} size="lg" iconRight={<FileSignature size={18} />}>
          Перейти к подписанию
        </ButtonLink>
        <AskButton variant="text" question="Объясни простыми словами условия одобренного кредита: что я буду платить и чем рискую?">
          Разобраться в условиях
        </AskButton>
      </div>
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
        <ButtonLink to="/app/applications/new" variant="secondary" iconRight={<ArrowUpRight size={16} />}>
          Подать новую заявку
        </ButtonLink>
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
    case 'SIGNING':
      return (
        <div className={styles.row}>
          <Quiet icon={<FileSignature size={20} />} title="Договор ждёт подписи">
            Осталось подтвердить подписание кодом — это займёт меньше минуты.
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
          <Quiet icon={<PartyPopper size={20} />} title={`${formatMoney(application.amount)} на расчётном счёте`}>
            {application.contract ? `Договор № ${application.contract.number}. ` : ''}Ниже — график платежей.
          </Quiet>
          <ScheduleTable application={application} />
        </div>
      )
    case 'REJECTED':
      return <RejectedBlock application={application} />
    case 'CLIENT_DECLINED':
    case 'CANCELLED':
      return (
        <div className={styles.row}>
          <Quiet icon={<CheckCircle2 size={20} />} title={application.status === 'CANCELLED' ? 'Заявка отменена' : 'Вы отклонили предложение'}>
            Подать новую заявку можно в любой момент — данные компании уже сохранены.
          </Quiet>
          <ButtonLink to="/app/applications/new" variant="secondary" icon={<FilePlus2 size={16} />}>
            Новая заявка
          </ButtonLink>
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

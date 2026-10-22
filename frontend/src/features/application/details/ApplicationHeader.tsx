import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { applicationsApi, type Application } from '@/api'
import { formatDate, formatTerm } from '@/shared/lib/dates'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { Button, StatusBadge } from '@/shared/ui'
import { useApplicationCache } from './useApplication'
import styles from './ApplicationHeader.module.css'

const CANCELLABLE = new Set(['NEED_INFO', 'APPROVED'])

export function ApplicationHeader({ application }: { application: Application }) {
  const [confirming, setConfirming] = useState(false)
  const updateCache = useApplicationCache(application.id)
  const cancel = useMutation({
    mutationFn: () => applicationsApi.cancel(application.id),
    onSuccess: (next) => {
      setConfirming(false)
      updateCache(next)
    },
  })
  const offer = application.offer
  const agreed = offer && application.status !== 'COUNTER_OFFER' && offer.status !== 'DECLINED' ? offer : null
  const amount = agreed?.amount ?? application.amount
  const term = agreed?.term ?? application.term
  const rate = agreed?.rate ?? application.product.base_rate
  const revolving = application.product.repayment === 'REVOLVING'
  const requestedLabel = application.status === 'COUNTER_OFFER' ? ' в заявке' : ''

  return (
    <header className={styles.header}>
      <Link to="/app/applications" className={styles.back}>
        <ArrowLeft size={16} /> Мои заявки
      </Link>
      <div className={styles.top}>
        <div className={styles.titles}>
          <span className={styles.eyebrow}>Заявка {application.number}</span>
          <div className={styles.titleRow}>
            <h1>{application.product.name}</h1>
            <StatusBadge status={application.status} />
          </div>
        </div>
        {CANCELLABLE.has(application.status) && (
          <div className={styles.cancel}>
            {confirming ? (
              <>
                <span className={styles.cancelQuestion}>Отменить заявку?</span>
                <Button size="sm" variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                  Да, отменить
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Нет
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Отменить заявку
              </Button>
            )}
          </div>
        )}
      </div>
      <dl className={styles.meta}>
        <div className={styles.metaMain}>
          <dt>
            {revolving ? 'Лимит' : 'Сумма'}
            {requestedLabel}
          </dt>
          <dd className="tabular">{formatMoney(amount)}</dd>
        </div>
        <div>
          <dt>Срок{requestedLabel}</dt>
          <dd>{formatTerm(term)}</dd>
        </div>
        <div>
          <dt>{agreed ? 'Ставка' : 'Базовая ставка'}</dt>
          <dd>{formatRate(rate)}</dd>
        </div>
        <div>
          <dt>Создана</dt>
          <dd>{formatDate(application.created_at)}</dd>
        </div>
        {application.submitted_at && (
          <div>
            <dt>Отправлена</dt>
            <dd>{formatDate(application.submitted_at)}</dd>
          </div>
        )}
      </dl>
      {cancel.isError && <p className={styles.error}>Не удалось отменить заявку. Попробуйте ещё раз.</p>}
    </header>
  )
}

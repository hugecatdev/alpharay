import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Check } from 'lucide-react'
import { applicationsApi, type Application, type Offer } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { cn } from '@/shared/lib/cn'
import { formatDate, formatTerm } from '@/shared/lib/dates'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { Alert, Button } from '@/shared/ui'
import { useApplicationCache } from './useApplication'
import styles from './CounterOfferBlock.module.css'

type Better = 'lower' | 'higher' | 'none'

interface Row {
  label: string
  requested: number
  offered: number
  format: (value: number) => string
  better: Better
  emphasis?: boolean
}

function overpayment(amount: number, term: number, monthly: number) {
  return Math.max(0, Math.round(monthly * term - amount))
}

function rowsFor(offer: Offer): Row[] {
  const { requested } = offer
  return [
    { label: 'Сумма', requested: requested.amount, offered: offer.amount, format: formatMoney, better: 'higher' },
    { label: 'Срок', requested: requested.term, offered: offer.term, format: formatTerm, better: 'none' },
    { label: 'Ставка', requested: requested.rate, offered: offer.rate, format: formatRate, better: 'lower' },
    {
      label: 'Платёж в месяц',
      requested: requested.monthly_payment,
      offered: offer.monthly_payment,
      format: formatMoney,
      better: 'lower',
      emphasis: true,
    },
    {
      label: 'Переплата за срок',
      requested: overpayment(requested.amount, requested.term, requested.monthly_payment),
      offered: overpayment(offer.amount, offer.term, offer.monthly_payment),
      format: formatMoney,
      better: 'lower',
    },
  ]
}

function Delta({ row }: { row: Row }) {
  const diff = row.offered - row.requested
  if (Math.abs(diff) < 0.005) return <span className={styles.same}>без изменений</span>
  const sign = diff > 0 ? '+' : '−'
  const tone =
    row.better === 'none' ? styles.deltaNeutral : (diff < 0) === (row.better === 'lower') ? styles.deltaGood : styles.deltaBad
  return (
    <span className={cn(styles.delta, tone)}>
      {sign}
      {row.format(Math.abs(diff))}
    </span>
  )
}

export function CounterOfferBlock({ application, offer }: { application: Application; offer: Offer }) {
  const [confirmDecline, setConfirmDecline] = useState(false)
  const updateCache = useApplicationCache(application.id)
  const accept = useMutation({ mutationFn: () => applicationsApi.acceptOffer(application.id), onSuccess: updateCache })
  const decline = useMutation({ mutationFn: () => applicationsApi.declineOffer(application.id), onSuccess: updateCache })
  const rows = rowsFor(offer)
  const busy = accept.isPending || decline.isPending

  return (
    <div className={styles.block} data-assist="counter-offer">
      <div className={styles.intro}>
        <p>
          Банк готов выдать кредит, но на других условиях. Сравните предложение с тем, что вы запрашивали, и решите,
          подходит ли оно бизнесу.
        </p>
        <AskButton variant="chip" question="Почему банк предлагает другие условия и стоит ли их принимать?">
          Почему такие условия?
        </AskButton>
      </div>

      <div className={styles.compare} role="table" aria-label="Сравнение условий">
        <div className={cn(styles.row, styles.headRow)} role="row">
          <span role="columnheader" />
          <span role="columnheader">Вы запросили</span>
          <span role="columnheader" aria-hidden />
          <span role="columnheader" className={styles.offeredHead}>
            Предложение банка
          </span>
        </div>
        {rows.map((row) => {
          const changed = Math.abs(row.offered - row.requested) >= 0.005
          return (
            <div key={row.label} className={cn(styles.row, changed && styles.changed, row.emphasis && styles.emphasis)} role="row">
              <span className={styles.label} role="rowheader">
                {row.label}
              </span>
              <span className={styles.requested} role="cell">
                {row.format(row.requested)}
              </span>
              <span className={styles.arrow} aria-hidden>
                <ArrowRight size={14} />
              </span>
              <span className={styles.offered} role="cell">
                <strong>{row.format(row.offered)}</strong>
                <Delta row={row} />
              </span>
            </div>
          )
        })}
      </div>

      <p className={styles.validity}>Предложение действует до {formatDate(offer.valid_until)}</p>

      {(accept.isError || decline.isError) && (
        <Alert tone="danger" title="Не получилось сохранить решение">
          Попробуйте ещё раз через минуту.
        </Alert>
      )}

      {confirmDecline ? (
        <div className={styles.confirm}>
          <span>Отклонить предложение? Заявка будет закрыта, но вы сможете подать новую.</span>
          <div className={styles.actions}>
            <Button variant="danger" loading={decline.isPending} disabled={accept.isPending} onClick={() => decline.mutate()}>
              Да, отклонить
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDecline(false)}>
              Вернуться
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button loading={accept.isPending} disabled={decline.isPending} icon={<Check size={16} />} onClick={() => accept.mutate()}>
            Принять предложение
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => setConfirmDecline(true)}>
            Отклонить
          </Button>
        </div>
      )}
    </div>
  )
}

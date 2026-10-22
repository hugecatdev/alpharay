import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, CheckCircle2, FileSignature, KeyRound, LayoutGrid } from 'lucide-react'
import { ApiError, applicationsApi, queryKeys, type Application, type ApplicationStatus } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { creditSummary } from '@/shared/lib/annuity'
import { formatTerm } from '@/shared/lib/dates'
import { formatMoney, formatRate } from '@/shared/lib/money'
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Skeleton,
  Spinner,
  Stat,
  Stepper,
} from '@/shared/ui'
import { useApplication, useApplicationCache } from './details/useApplication'
import styles from './SignPage.module.css'

const ALLOWED: ApplicationStatus[] = ['APPROVED', 'SIGNING', 'SIGNED', 'DISBURSED']

const STEPS = [
  { key: 'read', title: 'Ознакомление' },
  { key: 'confirm', title: 'Подтверждение' },
  { key: 'payout', title: 'Зачисление' },
]

function stepIndex(status: ApplicationStatus): number {
  if (status === 'APPROVED') return 0
  if (status === 'SIGNING') return 1
  return 2
}

function contractDocument(html: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>
body{margin:0;padding:28px 32px;font:14px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#20211f;background:#fff}
h1,h2,h3{line-height:1.3;letter-spacing:-.01em}h1{font-size:20px}h2{font-size:16px;margin-top:22px}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #e3e4df;padding:8px 10px;text-align:left}
</style></head><body>${html}</body></html>`
}

function Terms({ application }: { application: Application }) {
  const offer = application.offer
  const amount = offer?.amount ?? application.amount
  const term = offer?.term ?? application.term
  const rate = offer?.rate ?? application.product.base_rate
  const revolving = application.product.repayment === 'REVOLVING'
  const monthly = offer?.monthly_payment ?? creditSummary(application.product.repayment, amount, term, rate).monthly_payment
  return (
    <div className={styles.terms}>
      <Stat label={revolving ? 'Лимит' : 'Сумма'} value={formatMoney(amount)} size="md" />
      <Stat label={revolving ? 'Срок лимита' : 'Срок'} value={formatTerm(term)} size="md" />
      <Stat label="Ставка" value={formatRate(rate)} size="md" />
      <Stat
        label={revolving ? 'Проценты в месяц, максимум' : 'Платёж в месяц'}
        value={formatMoney(monthly)}
        size="md"
        tone="accent"
      />
    </div>
  )
}

function ContractView({ applicationId }: { applicationId: string }) {
  const contract = useQuery({
    queryKey: queryKeys.contract(applicationId),
    queryFn: () => applicationsApi.contract(applicationId),
    staleTime: Infinity,
  })
  return (
    <Card
      padding="none"
      className={styles.contractCard}
      assist="contract"
      title={contract.data ? `Договор № ${contract.data.number}` : 'Кредитный договор'}
      actions={<AskButton question="Что я подписываю? Объясни главные условия договора простыми словами." />}
    >
      {contract.isPending ? (
        <div className={styles.contractLoading}>
          <Skeleton height={18} width="60%" />
          <Skeleton height={14} />
          <Skeleton height={14} />
          <Skeleton height={14} width="80%" />
        </div>
      ) : contract.isError ? (
        <div className={styles.contractLoading}>
          <ErrorState error={contract.error} onRetry={() => void contract.refetch()} />
        </div>
      ) : (
        <iframe title="Текст кредитного договора" className={styles.contract} sandbox="" srcDoc={contractDocument(contract.data.html)} />
      )}
    </Card>
  )
}

function ReviewStep({ application, onSigned }: { application: Application; onSigned: (code: string) => void }) {
  const queryClient = useQueryClient()
  const [agreed, setAgreed] = useState(false)
  const [touched, setTouched] = useState(false)
  const sign = useMutation({
    mutationFn: () => applicationsApi.sign(application.id),
    onSuccess: (response) => {
      onSigned(response.confirmation_code)
      void queryClient.invalidateQueries({ queryKey: queryKeys.application(application.id) })
    },
  })
  return (
    <>
      <ContractView applicationId={application.id} />
      <Card className={styles.actionCard}>
        <div data-assist="sign-confirm" className={styles.agree}>
          <Checkbox
            label="С условиями договора ознакомлен(а)"
            description="Подписывая договор, вы принимаете обязательство вносить платежи по графику независимо от результатов бизнеса."
            checked={agreed}
            invalid={touched && !agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
        </div>
        {sign.isError && (
          <Alert tone="danger" title="Не удалось начать подписание">
            {sign.error instanceof Error ? sign.error.message : 'Попробуйте ещё раз'}
          </Alert>
        )}
        <div className={styles.actions}>
          <Button
            size="lg"
            loading={sign.isPending}
            iconRight={<FileSignature size={18} />}
            onClick={() => {
              setTouched(true)
              if (agreed) sign.mutate()
            }}
          >
            Подписать
          </Button>
          {touched && !agreed && <span className={styles.hint}>Отметьте, что ознакомились с условиями</span>}
        </div>
      </Card>
    </>
  )
}

function ConfirmStep({
  application,
  generated,
  onGenerated,
}: {
  application: Application
  generated: string | null
  onGenerated: (code: string) => void
}) {
  const updateCache = useApplicationCache(application.id)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const regenerate = useMutation({
    mutationFn: () => applicationsApi.sign(application.id),
    onSuccess: (response) => onGenerated(response.confirmation_code),
  })

  const confirm = useMutation({
    mutationFn: () => applicationsApi.confirmSign(application.id, code),
    onSuccess: (next) => {
      setError(null)
      updateCache(next)
    },
    onError: (failure) => {
      setError(
        failure instanceof ApiError && failure.status === 400
          ? 'Неверный код. Проверьте и попробуйте ещё раз.'
          : 'Не удалось подтвердить подписание. Попробуйте ещё раз.',
      )
    },
  })

  return (
    <Card className={styles.actionCard} title="Подтвердите подписание" eyebrow="Шаг 2 из 3">
      {generated ? (
        <Alert tone="info" icon={<KeyRound size={18} />} title="Код подтверждения сформирован в кабинете">
          Демо-режим: введите код <strong className={styles.code}>{generated}</strong>. В рабочей версии код приходит в защищённое
          приложение банка — без SMS и почты.
        </Alert>
      ) : (
        <Alert
          tone="neutral"
          icon={<KeyRound size={18} />}
          title="Код подтверждения уже сформирован"
          actions={
            <Button size="sm" variant="secondary" loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
              Сформировать новый код
            </Button>
          }
        >
          Если вы не видите код, сформируйте новый — он появится здесь же, в кабинете.
        </Alert>
      )}
      <form
        className={styles.codeForm}
        onSubmit={(event) => {
          event.preventDefault()
          if (code.length === 4) confirm.mutate()
        }}
      >
        <Field label="Код подтверждения" error={error ?? undefined} assist="sign-code">
          {(id) => (
            <Input
              id={id}
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              placeholder="••••"
              className={styles.codeInput}
              invalid={Boolean(error)}
              autoFocus
              onChange={(event) => {
                setError(null)
                setCode(event.target.value.replace(/\D/g, '').slice(0, 4))
              }}
            />
          )}
        </Field>
        <Button type="submit" size="lg" disabled={code.length !== 4} loading={confirm.isPending} iconRight={<CheckCircle2 size={18} />}>
          Подтвердить
        </Button>
      </form>
    </Card>
  )
}

function DisbursingStep() {
  return (
    <Card className={styles.waiting} padding="lg">
      <Spinner size={28} />
      <div>
        <h2>Договор подписан, зачисляем средства…</h2>
        <p className={styles.muted}>Обычно это занимает несколько секунд. Страница обновится сама.</p>
      </div>
    </Card>
  )
}

function DoneStep({ application }: { application: Application }) {
  const amount = application.offer?.amount ?? application.amount
  return (
    <Card className={styles.done} padding="lg">
      <span className={styles.doneIcon}>
        <CheckCircle2 size={34} />
      </span>
      <span className={styles.doneEyebrow}>Готово</span>
      <h1 className={styles.doneTitle}>Средства зачислены</h1>
      <strong className={styles.doneAmount}>{formatMoney(amount)}</strong>
      <p className={styles.muted}>
        {application.contract ? `По договору № ${application.contract.number}. ` : ''}Деньги уже на расчётном счёте компании.
      </p>
      <div className={styles.doneActions}>
        <ButtonLink to={`/app/applications/${application.id}`} iconRight={<ArrowUpRight size={16} />}>
          График платежей
        </ButtonLink>
        <ButtonLink to="/app" variant="secondary" icon={<LayoutGrid size={16} />}>
          На главную
        </ButtonLink>
      </div>
    </Card>
  )
}

export function SignPage() {
  const { id = '' } = useParams()
  const query = useApplication(id, { interval: 1000 })
  const application = query.data
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)

  useAssistantScreen({
    screen: 'sign',
    title: 'Подписание договора',
    applicationId: id || null,
    data: {
      status: application?.status ?? null,
      contract_number: application?.contract?.number ?? null,
    },
    suggestions: ['Что я подписываю?', 'Можно ли погасить досрочно?', 'Что будет при просрочке?'],
  })

  if (query.isPending) return <PageLoader label="Готовим договор…" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!application) return null
  if (!ALLOWED.includes(application.status)) return <Navigate to={`/app/applications/${application.id}`} replace />

  const current = stepIndex(application.status)
  const finished = application.status === 'DISBURSED'

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`Заявка ${application.number}`}
        title={finished ? 'Кредит выдан' : 'Подписание договора'}
        description={finished ? undefined : 'Проверьте условия, подтвердите подписание — и деньги поступят на расчётный счёт.'}
      />
      <Stepper steps={STEPS} current={finished ? 3 : current} completed={finished ? 2 : current - 1} />
      {!finished && <Terms application={application} />}
      {application.status === 'APPROVED' && <ReviewStep application={application} onSigned={setGeneratedCode} />}
      {application.status === 'SIGNING' && (
        <ConfirmStep application={application} generated={generatedCode} onGenerated={setGeneratedCode} />
      )}
      {application.status === 'SIGNED' && <DisbursingStep />}
      {finished && <DoneStep application={application} />}
    </div>
  )
}

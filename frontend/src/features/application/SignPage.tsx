import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, CheckCircle2, FileSignature, FlaskConical, KeyRound, LayoutGrid, ShieldCheck } from 'lucide-react'
import { applicationsApi, queryKeys, type Application, type ApplicationStatus, type SigningCertificate } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { creditSummary } from '@/shared/lib/annuity'
import { formatDate, formatTerm } from '@/shared/lib/dates'
import { formatMoney, formatRate } from '@/shared/lib/money'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  ChoiceCard,
  ErrorState,
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

const ALLOWED: ApplicationStatus[] = ['OFFER_ACCEPTED', 'SIGNING', 'SIGNED', 'DISBURSED']

const STEPS = [
  { key: 'read', title: 'Ознакомление' },
  { key: 'confirm', title: 'Подпись КЭП' },
  { key: 'payout', title: 'Зачисление' },
]

function stepIndex(status: ApplicationStatus): number {
  if (status === 'OFFER_ACCEPTED') return 0
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

function ReviewStep({ application }: { application: Application }) {
  const queryClient = useQueryClient()
  const [agreed, setAgreed] = useState(false)
  const [touched, setTouched] = useState(false)
  const sign = useMutation({
    mutationFn: () => applicationsApi.sign(application.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.application(application.id) }),
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

function CertificateOption({
  certificate,
  selected,
  onSelect,
}: {
  certificate: SigningCertificate
  selected: boolean
  onSelect: () => void
}) {
  const invalid = Boolean(certificate.problem)
  return (
    <ChoiceCard
      selected={selected}
      onSelect={onSelect}
      disabled={invalid}
      icon={<ShieldCheck size={18} />}
      badge={<Badge tone={invalid ? 'danger' : 'success'}>{invalid ? 'Недействителен' : 'Действителен'}</Badge>}
      title={certificate.owner_name}
      description={`${certificate.owner_title} · ${certificate.organization} · ИНН ${certificate.inn}`}
      meta={
        certificate.problem ??
        `${certificate.issuer} · № ${certificate.serial.slice(0, 8)}…${certificate.serial.slice(-4)} · до ${formatDate(certificate.valid_to)}`
      }
    />
  )
}

function CodeSignature({ application }: { application: Application }) {
  const updateCache = useApplicationCache(application.id)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const issue = useMutation({ mutationFn: () => applicationsApi.sign(application.id) })
  const confirm = useMutation({
    mutationFn: () => applicationsApi.confirmSign(application.id, code.trim()),
    onSuccess: (next) => updateCache(next),
  })

  if (!open) {
    return (
      <Button
        variant="link"
        onClick={() => {
          setOpen(true)
          issue.mutate()
        }}
      >
        Нет КЭП под рукой? Подписать кодом подтверждения
      </Button>
    )
  }

  return (
    <div className={styles.code} data-assist="sign-code">
      <Alert tone="neutral" icon={<FlaskConical size={18} />} title="Простая электронная подпись — демо">
        В рабочей версии код пришёл бы push-уведомлением в приложение банка. Здесь SMS не отправляется, код показан на
        экране: <strong className="tabular">{issue.data?.confirmation_code ?? '…'}</strong>
      </Alert>
      <div className={styles.actions}>
        <Input
          aria-label="Код подтверждения"
          inputMode="numeric"
          maxLength={6}
          placeholder="Код"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
        <Button loading={confirm.isPending} disabled={!code.trim()} onClick={() => confirm.mutate()}>
          Подписать кодом
        </Button>
      </div>
      {(issue.isError || confirm.isError) && (
        <Alert tone="danger" title="Не удалось подписать договор">
          {(confirm.error ?? issue.error)?.message ?? 'Попробуйте ещё раз'}
        </Alert>
      )}
    </div>
  )
}

function SignatureStep({ application }: { application: Application }) {
  const updateCache = useApplicationCache(application.id)
  const [chosen, setChosen] = useState<string | null>(null)
  const certificates = useQuery({
    queryKey: queryKeys.certificates(application.id),
    queryFn: () => applicationsApi.certificates(application.id),
  })
  const usable = certificates.data?.filter((item) => !item.problem) ?? []
  const selected = chosen ?? (usable.length === 1 ? usable[0].id : null)

  const sign = useMutation({
    mutationFn: (certificateId: string) => applicationsApi.signKep(application.id, certificateId),
    onSuccess: (next) => updateCache(next),
  })

  return (
    <Card className={styles.actionCard} title="Подпишите договор КЭП" eyebrow="Шаг 2 из 3">
      <Alert tone="info" icon={<KeyRound size={18} />} title="Нужна квалифицированная электронная подпись руководителя">
        Договор кредита подписывает лично руководитель компании или индивидуальный предприниматель — сертификатом УЦ ФНС
        России. Такая подпись равна собственноручной.
      </Alert>
      {certificates.isPending ? (
        <div className={styles.certificates}>
          <Skeleton height={112} />
          <Skeleton height={112} />
        </div>
      ) : certificates.isError ? (
        <ErrorState error={certificates.error} onRetry={() => void certificates.refetch()} />
      ) : (
        <div className={styles.certificates} data-assist="sign-certificate">
          {certificates.data.map((certificate) => (
            <CertificateOption
              key={certificate.id}
              certificate={certificate}
              selected={selected === certificate.id}
              onSelect={() => {
                sign.reset()
                setChosen(certificate.id)
              }}
            />
          ))}
        </div>
      )}
      {sign.isError && (
        <Alert tone="danger" title="Не удалось подписать договор">
          {sign.error instanceof Error ? sign.error.message : 'Попробуйте ещё раз'}
        </Alert>
      )}
      <div className={styles.actions}>
        <Button
          size="lg"
          disabled={!selected}
          loading={sign.isPending}
          iconRight={<FileSignature size={18} />}
          onClick={() => {
            if (selected) sign.mutate(selected)
          }}
        >
          Подписать КЭП
        </Button>
        {certificates.isSuccess && usable.length === 0 && (
          <span className={styles.hint}>На носителе нет действующего сертификата руководителя</span>
        )}
      </div>
      <CodeSignature application={application} />
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
  const amount = application.disbursement?.amount ?? application.offer?.amount ?? application.amount
  const certificate = application.contract?.certificate
  const disbursement = application.disbursement
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
      {certificate && (
        <p className={styles.signature}>
          <ShieldCheck size={16} />
          Подписан КЭП: {certificate.owner_name}, сертификат № {certificate.serial}, {certificate.issuer}
        </p>
      )}
      {disbursement && (
        <p className={styles.signature}>
          <FlaskConical size={16} />
          Выдача смоделирована: операция {disbursement.operation_number}, реальный платёж не проводился
        </p>
      )}
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
      <Alert tone="neutral" icon={<FlaskConical size={18} />} title="Демо-режим">
        Подписание и выдача смоделированы: КриптоПро, удостоверяющий центр и банковские системы не вызываются, деньги не
        перечисляются.
      </Alert>
      {!finished && <Terms application={application} />}
      {application.status === 'OFFER_ACCEPTED' && <ReviewStep application={application} />}
      {application.status === 'SIGNING' && <SignatureStep application={application} />}
      {application.status === 'SIGNED' && <DisbursingStep />}
      {finished && <DoneStep application={application} />}
    </div>
  )
}

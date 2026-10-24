import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Save } from 'lucide-react'
import type { Application, CompanyInsights, Product } from '@/api'
import { useConfig } from '@/shared/hooks/useConfig'
import { creditSummary } from '@/shared/lib/annuity'
import { ButtonLink, Card, ErrorState, PageHeader, PageLoader, StatusBadge, Stepper } from '@/shared/ui'
import { AmountStep } from './steps/AmountStep'
import { CompanyStep } from './steps/CompanyStep'
import { DocumentsStep } from './steps/DocumentsStep'
import { FinancialsStep } from './steps/FinancialsStep'
import { ProductStep } from './steps/ProductStep'
import { ReviewStep } from './steps/ReviewStep'
import { runPrecheck } from './wizard/metrics'
import { completedIndex, isStepKey, stepIndex, WIZARD_STEPS, writeProgress, type StepKey } from './wizard/steps'
import { SummaryBar } from './wizard/SummaryBar'
import type { LiveParams, StepNav } from './wizard/types'
import { useApplicationQuery, useInsights } from './wizard/useWizardData'
import styles from './ApplicationWizard.module.css'

const MOCK_FAIL_MODES = [1, 2] as const

const descriptions: Record<StepKey, string> = {
  product: 'Начните с цели — подскажем подходящий продукт. Условия можно поменять до отправки заявки.',
  amount: 'Выберите сумму и срок, которые будут по силам бизнесу.',
  company: 'Убедитесь, что реквизиты актуальны — на эту компанию оформим заявку и договор.',
  financials: 'Выручка, расходы и текущие платежи за последние 12 месяцев.',
  documents: 'Документы нужны не для всех заявок — список ниже покажет, что приложить вам.',
  review: 'Проверьте всё перед отправкой — после неё заявку уже не изменить.',
}

function buildSummary(application: Application | null, products: Product[], live: LiveParams, insights: CompanyInsights | undefined) {
  const product = products.find((item) => item.code === live.productCode) ?? application?.product
  const amount = application ? live.amount ?? application.amount : null
  const term = application ? live.term ?? application.term : null
  const revolving = product?.repayment === 'REVOLVING'
  if (!product || !amount || !term) return { productName: product?.name ?? null, amount, term, monthly: null, level: null, revolving }
  return {
    productName: product.name,
    amount,
    term,
    monthly: creditSummary(product.repayment, amount, term, product.base_rate).monthly_payment,
    level: runPrecheck(amount, term, product.base_rate, product, insights).level,
    revolving,
  }
}

export function ApplicationWizard() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const config = useConfig()
  const applicationQuery = useApplicationQuery(id)
  const insightsQuery = useInsights()
  const [live, setLive] = useState<{ key: string; values: LiveParams }>({ key: '', values: {} })
  const liveKeyRef = useRef('')
  const stepParam = searchParams.get('step')

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [stepParam])
  const mockFail = MOCK_FAIL_MODES.find((mode) => String(mode) === searchParams.get('mock_fail')) ?? 0
  const presetProduct = searchParams.get('product')

  const handleLive = useCallback((next: LiveParams) => {
    const key = liveKeyRef.current
    setLive((current) => ({ key, values: current.key === key ? { ...current.values, ...next } : next }))
  }, [])

  const application = id ? applicationQuery.data ?? null : null
  const products = config.data?.products ?? []
  const insights = insightsQuery.data

  const buildSearch = useCallback(
    (key: StepKey) => {
      const params = new URLSearchParams({ step: key })
      if (mockFail) params.set('mock_fail', String(mockFail))
      return params.toString()
    },
    [mockFail],
  )

  if (config.isPending || (id && applicationQuery.isPending)) return <PageLoader />
  if (config.error) return <ErrorState error={config.error} onRetry={() => void config.refetch()} />
  if (id && applicationQuery.error) return <ErrorState error={applicationQuery.error} onRetry={() => void applicationQuery.refetch()} />
  if (application && application.status !== 'DRAFT') return <Navigate to={`/app/applications/${application.id}`} replace />

  const completed = completedIndex(application)
  const requested: StepKey = !application
    ? 'product'
    : isStepKey(stepParam)
      ? stepParam
      : WIZARD_STEPS[Math.min(completed + 1, WIZARD_STEPS.length - 1)].key
  const currentIndex = application ? Math.min(stepIndex(requested), completed + 1, WIZARD_STEPS.length - 1) : 0
  const current = WIZARD_STEPS[currentIndex]
  liveKeyRef.current = `${application?.id ?? 'new'}:${current.key}`
  const summary = buildSummary(application, products, live.key === liveKeyRef.current ? live.values : {}, insights)

  const goTo = (key: StepKey) => {
    if (!application) return
    navigate(`/app/applications/${application.id}/edit?${buildSearch(key)}`)
  }

  const nav: StepNav = {
    goTo,
    next: () => {
      if (!application) return
      writeProgress(application.id, currentIndex)
      const next = WIZARD_STEPS[Math.min(currentIndex + 1, WIZARD_STEPS.length - 1)]
      goTo(next.key)
    },
    back: () => {
      const previous = WIZARD_STEPS[Math.max(currentIndex - 1, 0)]
      goTo(previous.key)
    },
  }

  const onCreated = (createdId: string) => {
    writeProgress(createdId, 0)
    navigate(`/app/applications/${createdId}/edit?${buildSearch('amount')}`, { replace: true })
  }

  const waitingInsights = insightsQuery.isPending && (current.key === 'product' || current.key === 'amount' || current.key === 'financials')

  let content
  if (waitingInsights) {
    content = <PageLoader label="Смотрим обороты по счёту…" />
  } else if (!application || current.key === 'product') {
    content = (
      <ProductStep
        key={application?.id ?? 'new'}
        application={application}
        products={products}
        insights={insights}
        initialProductCode={presetProduct}
        onLive={handleLive}
        onCreated={onCreated}
        nav={nav}
      />
    )
  } else if (current.key === 'amount') {
    content = <AmountStep key={application.id} application={application} insights={insights} onLive={handleLive} nav={nav} />
  } else if (current.key === 'company') {
    content = <CompanyStep key={application.id} application={application} nav={nav} />
  } else if (current.key === 'financials') {
    content = <FinancialsStep key={application.id} application={application} insights={insights} nav={nav} />
  } else if (current.key === 'documents') {
    content = <DocumentsStep key={application.id} application={application} nav={nav} />
  } else {
    content = <ReviewStep key={application.id} application={application} insights={insights} nav={nav} mockFail={mockFail} />
  }

  return (
    <div className={styles.wizard}>
      <div className={styles.stepper}>
        <Stepper
          steps={WIZARD_STEPS.map((step) => ({ key: step.key, title: step.title }))}
          current={currentIndex}
          completed={application ? Math.max(completed, currentIndex - 1) : -1}
          onSelect={application ? (index) => goTo(WIZARD_STEPS[index].key) : undefined}
        />
      </div>
      <PageHeader
        eyebrow={application ? `Заявка ${application.number}` : 'Новая заявка'}
        title={current.heading}
        description={descriptions[current.key]}
        status={application ? <StatusBadge status={application.status} /> : undefined}
        actions={
          application ? (
            <ButtonLink to="/app/applications" variant="secondary" size="sm" icon={<Save size={15} />}>
              Сохранить и выйти
            </ButtonLink>
          ) : undefined
        }
      />
      <SummaryBar {...summary} />
      <Card padding="lg" className={styles.card}>
        {content}
      </Card>
    </div>
  )
}

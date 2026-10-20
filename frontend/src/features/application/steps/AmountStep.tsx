import { useEffect, useMemo, useState } from 'react'
import { ApiError, type Application, type CompanyInsights } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { useSettledValue } from '@/shared/hooks/useSettledValue'
import { cn } from '@/shared/lib/cn'
import { formatMoneyShort } from '@/shared/lib/money'
import { Alert, NumberSlider } from '@/shared/ui'
import { CashFlowFit } from '../wizard/CashFlowFit'
import { clamp, computeMetrics, runPrecheck, sharePercent, type CheckFix } from '../wizard/metrics'
import { PaymentSummary } from '../wizard/PaymentSummary'
import { PreCheck } from '../wizard/PreCheck'
import { RiskWarning } from '../wizard/RiskWarning'
import { ScheduleToggle } from '../wizard/ScheduleToggle'
import { TermCompare } from '../wizard/TermCompare'
import type { LiveParams, StepNav } from '../wizard/types'
import { usePatchApplication } from '../wizard/useWizardData'
import { WizardFooter } from '../wizard/WizardFooter'
import styles from './Steps.module.css'

interface AmountStepProps {
  application: Application
  insights: CompanyInsights | undefined
  onLive: (live: LiveParams) => void
  nav: StepNav
}

export function AmountStep({ application, insights, onLive, nav }: AmountStepProps) {
  const product = application.product
  const rate = product.base_rate
  const [amount, setAmount] = useState(() => clamp(application.amount, product.min_amount, product.max_amount))
  const [term, setTerm] = useState(() => clamp(application.term, product.min_term, product.max_term))
  const patch = usePatchApplication(application.id)

  const settledAmount = useSettledValue(amount)
  const settledTerm = useSettledValue(term)
  const pending = settledAmount !== amount || settledTerm !== term
  const metrics = useMemo(
    () => computeMetrics(settledAmount, settledTerm, rate, insights),
    [settledAmount, settledTerm, rate, insights],
  )
  const precheck = useMemo(
    () => runPrecheck(settledAmount, settledTerm, rate, product, insights),
    [settledAmount, settledTerm, rate, product, insights],
  )

  useEffect(() => {
    onLive({ amount: settledAmount, term: settledTerm })
  }, [settledAmount, settledTerm, onLive])

  useAssistantScreen({
    screen: 'wizard.amount',
    title: 'Заявка: сумма и срок',
    applicationId: application.id,
    data: {
      product_code: product.code,
      product_name: product.name,
      amount,
      term,
      rate,
      monthly_payment: metrics.monthly,
      overpayment: metrics.overpayment,
      total_payment: metrics.total,
      payment_share_of_cashflow: sharePercent(metrics.share),
      risk_level: metrics.riskLevel,
      precheck_level: precheck.level,
      min_amount: product.min_amount,
      max_amount: product.max_amount,
      min_term: product.min_term,
      max_term: product.max_term,
    },
    suggestions: ['Что такое переплата?', 'Какой срок выбрать?', 'Какие риски у этого кредита?'],
  })

  function applyFix(fix: CheckFix) {
    if (fix.amount !== undefined) setAmount(clamp(fix.amount, product.min_amount, product.max_amount))
    if (fix.term !== undefined) setTerm(clamp(fix.term, product.min_term, product.max_term))
  }

  const changed = amount !== application.amount || term !== application.term

  function save(after: () => void) {
    if (!changed) {
      after()
      return
    }
    patch.mutate({ amount, term }, { onSuccess: after })
  }

  return (
    <div className={styles.stack}>
      <div className={styles.calcWrap}>
        <div className={styles.calc}>
          <div className={styles.calcInputs}>
            <NumberSlider
              label="Сумма кредита"
              assist="amount"
              value={amount}
              min={product.min_amount}
              max={product.max_amount}
              step={50_000}
              suffix="₽"
              formatEnd={formatMoneyShort}
              onChange={setAmount}
              help={<AskButton question="Какую сумму кредита разумно запросить для моего бизнеса?" />}
            />
            <NumberSlider
              label="Срок кредита"
              assist="term"
              value={term}
              min={product.min_term}
              max={product.max_term}
              step={1}
              suffix="мес."
              formatEnd={(value) => `${value} мес.`}
              onChange={setTerm}
              help={<AskButton question="Как срок влияет на платёж и переплату?" />}
            />
          </div>
          <div className={cn(styles.results, pending && styles.pending)}>
            <PaymentSummary metrics={metrics} rate={rate} />
          </div>
        </div>
      </div>
      <div className={cn(styles.results, pending && styles.pending)}>
        <TermCompare amount={settledAmount} term={settledTerm} rate={rate} product={product} insights={insights} onSelect={setTerm} />
        <ScheduleToggle amount={settledAmount} term={settledTerm} rate={rate} />
        <CashFlowFit metrics={metrics} />
        <PreCheck result={precheck} onFix={applyFix} />
        <RiskWarning metrics={metrics} />
      </div>

      {patch.error && (
        <Alert tone="danger" title="Не удалось сохранить параметры">
          {patch.error instanceof ApiError ? patch.error.message : 'Попробуйте ещё раз'}
        </Alert>
      )}

      <WizardFooter onBack={() => save(nav.back)} onNext={() => save(nav.next)} loading={patch.isPending} />
    </div>
  )
}

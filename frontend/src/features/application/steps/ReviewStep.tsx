import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Send } from 'lucide-react'
import { ApiError, applicationsApi, queryKeys, type Application, type CompanyInsights, type Consents } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { documentKindLabels, purposeLabels, taxSystemLabels } from '@/shared/lib/labels'
import { formatMoney, formatRate } from '@/shared/lib/money'
import { Alert, Checkbox } from '@/shared/ui'
import { computeMetrics } from '../wizard/metrics'
import type { StepKey } from '../wizard/steps'
import type { StepNav } from '../wizard/types'
import { usePatchApplication } from '../wizard/useWizardData'
import { WizardFooter } from '../wizard/WizardFooter'
import styles from './Steps.module.css'

interface MissingItem {
  key: string
  label: string
  step: StepKey | null
}

const CONSENT_LABELS: Record<keyof Consents, string> = {
  bki: 'Согласие на запрос в бюро кредитных историй',
  personal_data: 'Согласие на обработку персональных данных',
  risks: 'Подтверждение, что вы ознакомились с рисками',
}

function describeMissing(code: string): MissingItem {
  const value = code.toLowerCase()
  if (value.includes('invoice')) return { key: code, label: 'Загрузите счёт на оборудование', step: 'documents' }
  if (value.includes('financ')) return { key: code, label: 'Заполните финансовые показатели', step: 'financials' }
  if (value.includes('company')) return { key: code, label: 'Подтвердите данные компании', step: 'company' }
  if (value.includes('bki')) return { key: code, label: CONSENT_LABELS.bki, step: null }
  if (value.includes('personal')) return { key: code, label: CONSENT_LABELS.personal_data, step: null }
  if (value.includes('risk')) return { key: code, label: CONSENT_LABELS.risks, step: null }
  if (value.includes('amount') || value.includes('term')) return { key: code, label: 'Проверьте сумму и срок', step: 'amount' }
  if (value.includes('product') || value.includes('purpose')) return { key: code, label: 'Выберите продукт и цель', step: 'product' }
  if (value.includes('document')) return { key: code, label: 'Добавьте документы', step: 'documents' }
  return { key: code, label: code, step: null }
}

function clientMissing(application: Application): MissingItem[] {
  const items: MissingItem[] = []
  if (!application.company_confirmed) items.push({ key: 'company', label: 'Подтвердите данные компании', step: 'company' })
  if (!application.financials) items.push({ key: 'financials', label: 'Заполните финансовые показатели', step: 'financials' })
  if (application.product.requires_invoice && !application.documents.some((document) => document.kind === 'EQUIPMENT_INVOICE')) {
    items.push({ key: 'invoice', label: 'Загрузите счёт на оборудование', step: 'documents' })
  }
  return items
}

interface Fact {
  label: string
  value: ReactNode
  tone?: 'default' | 'danger' | 'success' | 'warning'
}

function Facts({ items }: { items: Fact[] }) {
  return (
    <dl className={styles.facts}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd className={item.tone && item.tone !== 'default' ? styles[`factTone-${item.tone}`] : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function SummaryBlock({ title, step, nav, children }: { title: string; step: StepKey; nav: StepNav; children: ReactNode }) {
  return (
    <div className={styles.summaryBlock}>
      <div className={styles.summaryBlockHead}>
        <h4>{title}</h4>
        <button type="button" className={styles.editLink} onClick={() => nav.goTo(step)}>
          <Pencil size={13} /> Изменить
        </button>
      </div>
      {children}
    </div>
  )
}

interface ReviewStepProps {
  application: Application
  insights: CompanyInsights | undefined
  nav: StepNav
  mockFail: number
}

export function ReviewStep({ application, insights, nav, mockFail }: ReviewStepProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [consents, setConsents] = useState<Consents>(application.consents)
  const [showErrors, setShowErrors] = useState(false)
  const [serverMissing, setServerMissing] = useState<MissingItem[]>([])
  const patch = usePatchApplication(application.id)
  const revolving = application.product.repayment === 'REVOLVING'
  const metrics = computeMetrics(
    application.amount,
    application.term,
    application.product.base_rate,
    insights,
    application.product.repayment,
  )
  const missing = clientMissing(application)
  const missingConsents = (Object.keys(CONSENT_LABELS) as (keyof Consents)[]).filter((key) => !consents[key])

  const submit = useMutation({
    mutationFn: async () => {
      await applicationsApi.patch(application.id, { consents })
      return applicationsApi.submit(application.id, { mockFail })
    },
    onSuccess: (submitted) => {
      queryClient.setQueryData(queryKeys.application(application.id), submitted)
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
      navigate(`/app/applications/${application.id}`)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'INCOMPLETE') setServerMissing(error.missing.map(describeMissing))
      void queryClient.invalidateQueries({ queryKey: queryKeys.application(application.id) })
    },
  })

  useAssistantScreen({
    screen: 'wizard.review',
    title: 'Заявка: проверка и отправка',
    applicationId: application.id,
    data: {
      amount: application.amount,
      term: application.term,
      monthly_payment: metrics.monthly,
      product_name: application.product.name,
      missing_consents: missingConsents.map((key) => CONSENT_LABELS[key]).join('; ') || null,
      missing_steps: missing.map((item) => item.label).join('; ') || null,
    },
    suggestions: ['Что будет после отправки?', 'Зачем согласие на запрос в БКИ?', 'Сколько ждать решения?'],
  })

  function toggle(key: keyof Consents, value: boolean) {
    setConsents((current) => ({ ...current, [key]: value }))
  }

  function back() {
    const changed = (Object.keys(consents) as (keyof Consents)[]).some((key) => consents[key] !== application.consents[key])
    if (!changed) {
      nav.back()
      return
    }
    patch.mutate({ consents }, { onSettled: () => nav.back() })
  }

  function send() {
    setServerMissing([])
    if (missing.length || missingConsents.length) {
      setShowErrors(true)
      return
    }
    submit.mutate()
  }

  const financials = application.financials
  const purposeTitle = application.purpose_type ? purposeLabels[application.purpose_type].title : '—'
  const genericError = submit.error && !(submit.error instanceof ApiError && submit.error.code === 'INCOMPLETE') ? submit.error : null
  const listed = serverMissing.length ? serverMissing : showErrors ? missing : []

  return (
    <div className={styles.stack}>
      <div className={styles.summaryGrid} data-assist="summary">
        <SummaryBlock title="Продукт и цель" step="product" nav={nav}>
          <Facts
            items={[
              { label: 'Продукт', value: application.product.name },
              { label: 'Цель', value: purposeTitle },
              { label: 'Описание', value: application.purpose && application.purpose !== purposeTitle ? application.purpose : '—' },
            ]}
          />
        </SummaryBlock>
        <SummaryBlock title="Сумма и срок" step="amount" nav={nav}>
          <Facts
            items={[
              { label: revolving ? 'Лимит' : 'Сумма', value: formatMoney(application.amount) },
              { label: revolving ? 'Срок лимита' : 'Срок', value: `${application.term} мес.` },
              revolving
                ? { label: 'Проценты в месяц', value: `до ${formatMoney(metrics.monthly)}` }
                : { label: 'Платёж в месяц', value: `≈ ${formatMoney(metrics.monthly)}` },
              { label: 'Ставка', value: `от ${formatRate(application.product.base_rate)}` },
            ]}
          />
        </SummaryBlock>
        <SummaryBlock title="Компания" step="company" nav={nav}>
          <Facts
            items={[
              { label: 'Название', value: application.company.name },
              { label: 'ИНН', value: application.company.inn },
              {
                label: 'Данные',
                value: application.company_confirmed ? 'Подтверждены' : 'Не подтверждены',
                tone: application.company_confirmed ? 'success' : 'danger',
              },
            ]}
          />
        </SummaryBlock>
        <SummaryBlock title="Финансы" step="financials" nav={nav}>
          {financials ? (
            <Facts
              items={[
                { label: 'Выручка за 12 мес.', value: formatMoney(financials.revenue_12m) },
                { label: 'Чистая прибыль', value: formatMoney(financials.net_profit_12m) },
                { label: 'Платежи по кредитам', value: `${formatMoney(financials.monthly_debt_payments)}/мес.` },
                { label: 'Налоговый режим', value: taxSystemLabels[financials.tax_system] },
              ]}
            />
          ) : (
            <Facts items={[{ label: 'Показатели', value: 'Не заполнены', tone: 'danger' }]} />
          )}
        </SummaryBlock>
        <SummaryBlock title="Документы" step="documents" nav={nav}>
          <Facts
            items={
              application.documents.length
                ? application.documents.map((document) => ({ label: documentKindLabels[document.kind], value: document.filename }))
                : [{ label: 'Загружено', value: 'Нет файлов — выписку по счёту получим автоматически' }]
            }
          />
        </SummaryBlock>
      </div>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>
          Согласия
          <AskButton question="Зачем нужны согласия на запрос в БКИ и обработку данных?" />
        </h3>
        <div className={styles.consents}>
          <div data-assist="consent-bki">
            <Checkbox
              label={CONSENT_LABELS.bki}
              description="Банк запросит кредитную историю компании и руководителя"
              checked={consents.bki}
              invalid={showErrors && !consents.bki}
              onChange={(event) => toggle('bki', event.target.checked)}
            />
          </div>
          <div data-assist="consent-personal">
            <Checkbox
              label={CONSENT_LABELS.personal_data}
              description="Для проверки по ЕГРЮЛ, ФНС и рассмотрения заявки"
              checked={consents.personal_data}
              invalid={showErrors && !consents.personal_data}
              onChange={(event) => toggle('personal_data', event.target.checked)}
            />
          </div>
          <div data-assist="consent-risks" className={styles.consentRow}>
            <Checkbox
              label="Я понимаю, что кредит нужно возвращать независимо от результатов бизнеса, и ознакомился(-ась) с рисками"
              description={`Платёж ≈ ${formatMoney(metrics.monthly)} в месяц, переплата ${formatMoney(metrics.overpayment)} за весь срок`}
              checked={consents.risks}
              invalid={showErrors && !consents.risks}
              onChange={(event) => toggle('risks', event.target.checked)}
            />
            <AskButton question="Какие риски у этого кредита для моего бизнеса?" />
          </div>
        </div>
      </section>

      {showErrors && missingConsents.length > 0 && (
        <Alert tone="warning" title="Отметьте согласия">
          {missingConsents.map((key) => CONSENT_LABELS[key]).join('; ')}
        </Alert>
      )}

      {listed.length > 0 && (
        <Alert tone={serverMissing.length ? 'danger' : 'warning'} title="Заявку пока нельзя отправить — не хватает данных">
          <ul className={styles.missingList}>
            {listed.map((item) => (
              <li key={item.key}>
                {item.step ? (
                  <button type="button" onClick={() => item.step && nav.goTo(item.step)}>
                    {item.label}
                  </button>
                ) : (
                  item.label
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {genericError && (
        <Alert tone="danger" title="Не удалось отправить заявку">
          {genericError instanceof ApiError ? genericError.message : 'Попробуйте ещё раз'}
        </Alert>
      )}

      <Alert tone="neutral">
        После отправки заявка автоматически пройдёт проверку данных, запрос в ЕГРЮЛ, ФНС и БКИ и оценку. Статус будет обновляться на
        странице заявки — ничего не нужно ждать по почте или SMS.
      </Alert>

      <WizardFooter
        onBack={back}
        onNext={send}
        loading={submit.isPending || patch.isPending}
        nextLabel="Отправить заявку"
        nextIcon={<Send size={18} />}
        assist="submit"
        hint="Отправка бесплатна и ни к чему не обязывает"
      />
    </div>
  )
}

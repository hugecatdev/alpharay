import { useEffect, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Banknote, Factory, Hourglass, Package, Wallet } from 'lucide-react'
import { z } from 'zod'
import { ApiError, applicationsApi, queryKeys, type Application, type CompanyInsights, type Product, type PurposeType } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { cn } from '@/shared/lib/cn'
import { PURPOSE_ORDER, purposeLabels } from '@/shared/lib/labels'
import { formatMoneyShort, formatRate } from '@/shared/lib/money'
import { Alert, Badge, Field, Textarea } from '@/shared/ui'
import { clamp, defaultAmount, defaultTerm } from '../wizard/metrics'
import { usePatchApplication } from '../wizard/useWizardData'
import type { LiveParams, StepNav } from '../wizard/types'
import { WizardFooter } from '../wizard/WizardFooter'
import styles from './Steps.module.css'

const purposeIcons: Record<PurposeType, ReactNode> = {
  CASH_GAP: <Hourglass size={20} />,
  WORKING_CAPITAL: <Package size={20} />,
  EQUIPMENT: <Factory size={20} />,
}

const productIcons: Record<string, ReactNode> = {
  OVERDRAFT: <Wallet size={20} />,
  WORKING_CAPITAL: <Package size={20} />,
  EQUIPMENT: <Factory size={20} />,
}

const schema = z.object({
  purpose_type: z.enum(['WORKING_CAPITAL', 'CASH_GAP', 'EQUIPMENT'], {
    errorMap: () => ({ message: 'Выберите, на что нужны деньги' }),
  }),
  product_code: z.string({ required_error: 'Выберите продукт' }).min(1, 'Выберите продукт'),
  purpose: z.string().max(300, 'Не больше 300 символов'),
})

type Errors = Partial<Record<'purpose_type' | 'product_code' | 'purpose' | 'form', string>>

interface ProductStepProps {
  application: Application | null
  products: Product[]
  insights: CompanyInsights | undefined
  initialProductCode: string | null
  onLive: (live: LiveParams) => void
  onCreated: (id: string) => void
  nav: StepNav
}

function purposeText(purpose: PurposeType | null, text: string): string {
  if (text.trim()) return text.trim()
  return purpose ? purposeLabels[purpose].title : ''
}

export function ProductStep({ application, products, insights, initialProductCode, onLive, onCreated, nav }: ProductStepProps) {
  const queryClient = useQueryClient()
  const initialProduct = products.find((product) => product.code === (application?.product.code ?? initialProductCode))
  const [purposeType, setPurposeType] = useState<PurposeType | null>(
    application?.purpose_type ?? initialProduct?.purpose_types[0] ?? null,
  )
  const [productCode, setProductCode] = useState<string | null>(initialProduct?.code ?? null)
  const [text, setText] = useState(() => {
    if (!application) return ''
    const preset = application.purpose_type ? purposeLabels[application.purpose_type].title : ''
    return application.purpose === preset ? '' : application.purpose
  })
  const [errors, setErrors] = useState<Errors>({})
  const patch = usePatchApplication(application?.id ?? '')
  const create = useMutation({
    mutationFn: applicationsApi.create,
    onSuccess: (created) => {
      queryClient.setQueryData(queryKeys.application(created.id), created)
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications, exact: true })
      onCreated(created.id)
    },
  })

  const selected = products.find((product) => product.code === productCode)

  useEffect(() => {
    onLive({ productCode: productCode ?? undefined })
  }, [productCode, onLive])

  useAssistantScreen({
    screen: 'wizard.product',
    title: 'Заявка: выбор продукта',
    applicationId: application?.id ?? null,
    data: {
      purpose_type: purposeType,
      selected_product_code: productCode,
      selected_product_name: selected?.name ?? null,
      pre_approved_limit: insights?.pre_approved_limit ?? null,
    },
    suggestions: ['Чем отличаются продукты?', 'Какой продукт подходит для закупки товара?', 'Что такое предварительный лимит?'],
  })

  function choosePurpose(next: PurposeType) {
    setPurposeType(next)
    setErrors((current) => ({ ...current, purpose_type: undefined }))
    const current = products.find((product) => product.code === productCode)
    if (!current || !current.purpose_types.includes(next)) {
      const fitting = products.find((product) => product.purpose_types.includes(next))
      if (fitting) setProductCode(fitting.code)
    }
  }

  function submit() {
    const parsed = schema.safeParse({ purpose_type: purposeType ?? undefined, product_code: productCode ?? undefined, purpose: text })
    if (!parsed.success) {
      const next: Errors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (key === 'purpose_type' || key === 'product_code' || key === 'purpose') next[key] = issue.message
      }
      setErrors(next)
      return
    }
    const product = products.find((item) => item.code === parsed.data.product_code)
    if (!product) return
    setErrors({})
    const purpose = purposeText(parsed.data.purpose_type, parsed.data.purpose)
    if (!application) {
      create.mutate({
        product_code: product.code,
        amount: defaultAmount(product, insights),
        term: defaultTerm(product),
        purpose,
        purpose_type: parsed.data.purpose_type,
      })
      return
    }
    patch.mutate(
      {
        product_code: product.code,
        purpose,
        purpose_type: parsed.data.purpose_type,
        amount: clamp(application.amount, product.min_amount, product.max_amount),
        term: clamp(application.term, product.min_term, product.max_term),
      },
      { onSuccess: () => nav.next() },
    )
  }

  const failure = create.error ?? patch.error
  const pending = create.isPending || patch.isPending

  return (
    <div className={styles.stack}>
      {insights && insights.pre_approved_limit > 0 && (
        <Alert tone="info" title={`Предварительно доступно до ${formatMoneyShort(insights.pre_approved_limit)}`}>
          Рассчитали по оборотам вашего счёта в AlphaRay. Это ориентир, а не решение банка — финальные условия появятся после
          рассмотрения заявки.
        </Alert>
      )}

      <section className={styles.section} data-assist="purpose">
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            На что нужны деньги
            <AskButton question="Как цель кредита влияет на выбор продукта?" />
          </h3>
          <span className={styles.sectionHint}>Цель определяет продукт, срок и список документов</span>
        </div>
        <div className={styles.pills}>
          {PURPOSE_ORDER.map((purpose) => (
            <button
              key={purpose}
              type="button"
              aria-pressed={purposeType === purpose}
              className={cn(styles.pill, purposeType === purpose && styles.pillOn)}
              onClick={() => choosePurpose(purpose)}
            >
              {purposeIcons[purpose]}
              <span>{purposeLabels[purpose].title}</span>
            </button>
          ))}
        </div>
        <p className={styles.pillHint}>{purposeType ? purposeLabels[purposeType].hint : 'Выберите цель — подскажем подходящий продукт'}</p>
        {errors.purpose_type && <span className={styles.error}>{errors.purpose_type}</span>}
      </section>

      <section className={styles.section} data-assist="product-list">
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            Кредитный продукт
            <AskButton question="Чем отличаются кредитные продукты?" />
          </h3>
          <span className={styles.sectionHint}>Ставка и лимиты — до рассмотрения заявки</span>
        </div>
        <div className={styles.offersWrap}>
          <div className={styles.offers}>
            {products.map((product) => {
              const fits = purposeType ? product.purpose_types.includes(purposeType) : false
              const selectedProduct = productCode === product.code
              return (
                <button
                  key={product.code}
                  type="button"
                  data-assist={`product-${product.code}`}
                  aria-pressed={selectedProduct}
                  className={cn(styles.offer, selectedProduct && styles.offerOn)}
                  onClick={() => {
                    setProductCode(product.code)
                    if (!purposeType || !product.purpose_types.includes(purposeType)) setPurposeType(product.purpose_types[0] ?? purposeType)
                    setErrors((current) => ({ ...current, product_code: undefined, purpose_type: undefined }))
                  }}
                >
                  <span className={styles.offerHead}>
                    <span className={styles.offerIcon}>{productIcons[product.code] ?? <Banknote size={20} />}</span>
                    <span className={styles.offerName}>{product.name}</span>
                    <span className={styles.offerRadio} aria-hidden />
                  </span>
                  <span className={styles.offerFigures}>
                    <span className={styles.offerRate}>
                      <strong className="tabular">
                        <small>от</small> {formatRate(product.base_rate)}
                      </strong>
                      <span>годовых</span>
                    </span>
                    <span className={styles.offerStats}>
                      <span>
                        <strong className="tabular">{formatMoneyShort(product.max_amount)}</strong>
                        <span>сумма до</span>
                      </span>
                      <span>
                        <strong className="tabular">{product.max_term} мес.</strong>
                        <span>срок до</span>
                      </span>
                    </span>
                  </span>
                  <span className={styles.offerDescription}>{product.description}</span>
                  {purposeType && (
                    <Badge tone={fits ? 'success' : 'neutral'} className={styles.fitBadge}>
                      {fits ? 'Подходит под цель' : 'Для других целей'}
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        {errors.product_code && <span className={styles.error}>{errors.product_code}</span>}
        {selected?.requires_invoice && (
          <Alert tone="neutral">Для этого продукта понадобится счёт на оборудование — его можно будет загрузить на шаге «Документы».</Alert>
        )}
      </section>

      <Field
        label="Расскажите коротко, на что пойдут деньги"
        hint={`Необязательно. ${text.length}/300`}
        error={errors.purpose}
        assist="purpose-text"
      >
        {(id) => (
          <Textarea
            id={id}
            value={text}
            maxLength={300}
            rows={3}
            placeholder={purposeType ? `Например: ${purposeLabels[purposeType].hint.toLowerCase()}` : 'Например: закупка сырья к сезону'}
            onChange={(event) => setText(event.target.value)}
            invalid={Boolean(errors.purpose)}
          />
        )}
      </Field>

      {failure && (
        <Alert tone="danger" title="Не удалось сохранить">
          {failure instanceof ApiError ? failure.message : 'Попробуйте ещё раз'}
        </Alert>
      )}

      <WizardFooter onNext={submit} loading={pending} nextLabel={application ? 'Далее' : 'Перейти к сумме и сроку'} />
    </div>
  )
}

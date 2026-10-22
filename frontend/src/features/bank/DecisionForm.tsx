import { useMemo, useState, type ReactNode } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check, FileQuestion, SlidersHorizontal, X } from 'lucide-react'
import { ApiError, type BankApplication, type BankDecisionRequest, type BankDecisionType, type Repayment } from '@/api'
import { creditSummary } from '@/shared/lib/annuity'
import { cn } from '@/shared/lib/cn'
import { formatTerm } from '@/shared/lib/dates'
import { infoRequestOptions, rejectReasonOptions } from '@/shared/lib/labels'
import { formatMoney, formatMoneyShort, formatRate } from '@/shared/lib/money'
import { useConfig } from '@/shared/hooks/useConfig'
import { Alert, Button, Checkbox, Field, Input, NumberSlider, Select, Textarea } from '@/shared/ui'
import { useDecision } from './useBank'
import styles from './DecisionForm.module.css'

interface ModeMeta {
  type: BankDecisionType
  label: string
  icon: ReactNode
}

const MODES: ModeMeta[] = [
  { type: 'APPROVED', label: 'Одобрить', icon: <Check size={18} /> },
  { type: 'COUNTER_OFFER', label: 'На других условиях', icon: <SlidersHorizontal size={18} /> },
  { type: 'NEED_INFO', label: 'Запросить информацию', icon: <FileQuestion size={18} /> },
  { type: 'REJECTED', label: 'Отказать', icon: <X size={18} /> },
]

interface FormProps {
  application: BankApplication
  submitting: boolean
  onSubmit: (body: BankDecisionRequest) => void
  onCancel: () => void
}

function roundTo(value: number, step: number) {
  return Math.round(value / step) * step
}

function rateField() {
  return z
    .number({ invalid_type_error: 'Укажите ставку', required_error: 'Укажите ставку' })
    .min(1, 'Не меньше 1%')
    .max(60, 'Не больше 60%')
}

function FormActions({ submitting, onCancel, label, danger }: { submitting: boolean; onCancel: () => void; label: string; danger?: boolean }) {
  return (
    <div className={styles.actions}>
      <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
        Отмена
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={submitting}>
        {label}
      </Button>
    </div>
  )
}

function PaymentPreview({ amount, term, rate, repayment }: { amount: number; term: number; rate: number; repayment: Repayment }) {
  const summary = creditSummary(repayment, amount, term, Number.isFinite(rate) ? rate : 0)
  return (
    <div className={styles.preview}>
      <div>
        <span>{repayment === 'REVOLVING' ? 'Проценты при полном лимите' : 'Платёж в месяц'}</span>
        <strong className="tabular">{formatMoney(summary.monthly_payment)}</strong>
      </div>
      <div>
        <span>Переплата</span>
        <strong className="tabular">{formatMoney(summary.overpayment)}</strong>
      </div>
      <div>
        <span>Всего к возврату</span>
        <strong className="tabular">{formatMoney(summary.total_payment)}</strong>
      </div>
    </div>
  )
}

const approveSchema = z.object({
  rate: rateField(),
  comment: z.string().max(1000, 'Не больше 1000 символов'),
})

type ApproveValues = z.infer<typeof approveSchema>

function ApproveForm({ application, submitting, onSubmit, onCancel }: FormProps) {
  const recommended = application.recommendation?.type === 'APPROVED' ? application.recommendation.rate : undefined
  const form = useForm<ApproveValues>({
    resolver: zodResolver(approveSchema),
    defaultValues: { rate: recommended ?? application.product.base_rate, comment: '' },
  })
  const rate = form.watch('rate')
  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit((values) =>
        onSubmit({ type: 'APPROVED', amount: application.amount, term: application.term, rate: values.rate, comment: values.comment.trim() }),
      )}
    >
      <div className={styles.terms}>
        <div>
          <span>Сумма</span>
          <strong className="tabular">{formatMoney(application.amount)}</strong>
        </div>
        <div>
          <span>Срок</span>
          <strong className="tabular">{formatTerm(application.term)}</strong>
        </div>
      </div>
      <Field label="Ставка, % годовых" error={form.formState.errors.rate?.message}>
        {(id) => (
          <Input id={id} type="number" step="0.1" suffix="%" invalid={Boolean(form.formState.errors.rate)} {...form.register('rate', { valueAsNumber: true })} />
        )}
      </Field>
      <PaymentPreview amount={application.amount} term={application.term} rate={rate} repayment={application.product.repayment} />
      <Field label="Комментарий для клиента" hint="Необязательно" error={form.formState.errors.comment?.message}>
        {(id) => <Textarea id={id} rows={3} placeholder="Например: условия подтверждены" {...form.register('comment')} />}
      </Field>
      <FormActions submitting={submitting} onCancel={onCancel} label="Одобрить заявку" />
    </form>
  )
}

function CounterForm({ application, submitting, onSubmit, onCancel }: FormProps) {
  const product = application.product
  const schema = useMemo(
    () =>
      z.object({
        amount: z
          .number()
          .min(product.min_amount, `Не меньше ${formatMoney(product.min_amount)}`)
          .max(product.max_amount, `Не больше ${formatMoney(product.max_amount)}`),
        term: z
          .number()
          .int()
          .min(product.min_term, `Не меньше ${product.min_term} мес.`)
          .max(product.max_term, `Не больше ${product.max_term} мес.`),
        rate: rateField(),
        comment: z.string().trim().min(5, 'Объясните клиенту, почему условия изменены').max(1000, 'Не больше 1000 символов'),
      }),
    [product],
  )
  type CounterValues = z.infer<typeof schema>

  const recommendation = application.recommendation?.type === 'COUNTER_OFFER' ? application.recommendation : null
  const fallbackAmount = Math.max(product.min_amount, Math.min(product.max_amount, roundTo(application.amount * 0.7, 50_000)))
  const form = useForm<CounterValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: recommendation?.amount ?? fallbackAmount,
      term: recommendation?.term ?? application.term,
      rate: recommendation?.rate ?? Math.round((product.base_rate + 1) * 10) / 10,
      comment: '',
    },
  })
  const [amount, term, rate] = form.watch(['amount', 'term', 'rate'])
  const requested = creditSummary(product.repayment, application.amount, application.term, product.base_rate)
  const offered = creditSummary(product.repayment, amount, term, Number.isFinite(rate) ? rate : 0)
  const errors = form.formState.errors

  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit((values) =>
        onSubmit({ type: 'COUNTER_OFFER', amount: values.amount, term: values.term, rate: values.rate, comment: values.comment.trim() }),
      )}
    >
      {recommendation && <p className={styles.note}>Условия предзаполнены по рекомендации системы — их можно изменить.</p>}
      <Controller
        control={form.control}
        name="amount"
        render={({ field }) => (
          <NumberSlider
            label="Сумма"
            value={field.value}
            min={product.min_amount}
            max={product.max_amount}
            step={50_000}
            suffix="₽"
            formatEnd={formatMoneyShort}
            onChange={field.onChange}
            error={errors.amount?.message}
          />
        )}
      />
      <Controller
        control={form.control}
        name="term"
        render={({ field }) => (
          <NumberSlider
            label="Срок"
            value={field.value}
            min={product.min_term}
            max={product.max_term}
            step={1}
            suffix="мес."
            formatEnd={(value) => `${value} мес.`}
            onChange={field.onChange}
            error={errors.term?.message}
            accent="green"
          />
        )}
      />
      <Field label="Ставка, % годовых" error={errors.rate?.message}>
        {(id) => <Input id={id} type="number" step="0.1" suffix="%" invalid={Boolean(errors.rate)} {...form.register('rate', { valueAsNumber: true })} />}
      </Field>
      <table className={styles.compare}>
        <thead>
          <tr>
            <th />
            <th>Запрошено</th>
            <th>Предлагаем</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Сумма</td>
            <td>{formatMoney(application.amount)}</td>
            <td className={cn(amount !== application.amount && styles.changed)}>{formatMoney(amount)}</td>
          </tr>
          <tr>
            <td>Срок</td>
            <td>{formatTerm(application.term)}</td>
            <td className={cn(term !== application.term && styles.changed)}>{formatTerm(term)}</td>
          </tr>
          <tr>
            <td>Ставка</td>
            <td>{formatRate(product.base_rate)}</td>
            <td className={cn(rate !== product.base_rate && styles.changed)}>{Number.isFinite(rate) ? formatRate(rate) : '—'}</td>
          </tr>
          <tr>
            <td>Платёж</td>
            <td>{formatMoney(requested.monthly_payment)}</td>
            <td>{formatMoney(offered.monthly_payment)}</td>
          </tr>
          <tr>
            <td>Переплата</td>
            <td>{formatMoney(requested.overpayment)}</td>
            <td>{formatMoney(offered.overpayment)}</td>
          </tr>
        </tbody>
      </table>
      <Field label="Комментарий для клиента" error={errors.comment?.message}>
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            invalid={Boolean(errors.comment)}
            placeholder="Например: сумма снижена с учётом текущей долговой нагрузки"
            {...form.register('comment')}
          />
        )}
      </Field>
      <FormActions submitting={submitting} onCancel={onCancel} label="Отправить предложение" />
    </form>
  )
}

const needInfoSchema = z.object({
  items: z.array(z.string()).min(1, 'Выберите хотя бы один пункт'),
  comment: z.string().max(1000, 'Не больше 1000 символов'),
})

type NeedInfoValues = z.infer<typeof needInfoSchema>

function suggestedItems(application: BankApplication): string[] {
  const items: string[] = []
  if (application.discrepancies.some((item) => item.field === 'revenue_12m')) items.push('revenue_12m', 'statement_6m')
  if ((application.enrichment?.bki.max_overdue_days_24m ?? 0) > 0) items.push('overdue_explanation')
  if (application.product.requires_invoice && !application.documents.some((doc) => doc.kind === 'EQUIPMENT_INVOICE')) {
    items.push('equipment_invoice')
  }
  return items
}

function NeedInfoForm({ application, submitting, onSubmit, onCancel }: FormProps) {
  const form = useForm<NeedInfoValues>({
    resolver: zodResolver(needInfoSchema),
    defaultValues: { items: suggestedItems(application), comment: '' },
  })
  const errors = form.formState.errors
  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit((values) => onSubmit({ type: 'NEED_INFO', items: values.items, comment: values.comment.trim() }))}
    >
      <div className={styles.checklist} role="group" aria-label="Что запросить у клиента">
        {infoRequestOptions.map((option) => (
          <Checkbox
            key={option.code}
            value={option.code}
            label={option.label}
            description={option.type === 'document' ? 'Документ' : option.type === 'number' ? 'Число' : 'Текст'}
            invalid={Boolean(errors.items)}
            {...form.register('items')}
          />
        ))}
      </div>
      {errors.items?.message && <span className={styles.error}>{errors.items.message}</span>}
      <Field label="Комментарий для клиента" hint="Необязательно" error={errors.comment?.message}>
        {(id) => <Textarea id={id} rows={3} placeholder="Что именно нужно уточнить" {...form.register('comment')} />}
      </Field>
      <FormActions submitting={submitting} onCancel={onCancel} label="Запросить информацию" />
    </form>
  )
}

const rejectSchema = z.object({
  reason_code: z.string().min(1, 'Выберите причину'),
  comment: z.string().trim().min(5, 'Комментарий обязателен').max(1000, 'Не больше 1000 символов'),
})

type RejectValues = z.infer<typeof rejectSchema>

function RejectForm({ application, submitting, onSubmit, onCancel }: FormProps) {
  const form = useForm<RejectValues>({
    resolver: zodResolver(rejectSchema),
    defaultValues: { reason_code: application.scoring?.stop_factors.length ? 'STOP_FACTORS' : '', comment: '' },
  })
  const errors = form.formState.errors
  return (
    <form
      className={styles.form}
      onSubmit={form.handleSubmit((values) =>
        onSubmit({ type: 'REJECTED', reason_code: values.reason_code, comment: values.comment.trim() }),
      )}
    >
      <Field label="Причина отказа" error={errors.reason_code?.message}>
        {(id) => (
          <Select id={id} invalid={Boolean(errors.reason_code)} {...form.register('reason_code')}>
            <option value="">Выберите причину</option>
            {rejectReasonOptions.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Комментарий" hint="Клиент увидит его в причинах отказа" error={errors.comment?.message}>
        {(id) => <Textarea id={id} rows={3} invalid={Boolean(errors.comment)} {...form.register('comment')} />}
      </Field>
      <FormActions submitting={submitting} onCancel={onCancel} label="Отказать" danger />
    </form>
  )
}

const FORMS: Record<BankDecisionType, (props: FormProps) => ReactNode> = {
  APPROVED: ApproveForm,
  COUNTER_OFFER: CounterForm,
  NEED_INFO: NeedInfoForm,
  REJECTED: RejectForm,
}

export function DecisionForm({ application, onDecided }: { application: BankApplication; onDecided: () => void }) {
  const [mode, setMode] = useState<BankDecisionType | null>(null)
  const decision = useDecision(application.id)
  const config = useConfig()
  const threshold = config.data?.manual_review_amount_threshold
  const recommended = application.recommendation?.type
  const FormComponent = mode ? FORMS[mode] : null

  return (
    <div className={styles.root}>
      {threshold !== undefined && application.amount > threshold && (
        <p className={styles.note}>
          Сумма выше порога автоматического решения ({formatMoneyShort(threshold)}) — нужно решение специалиста.
        </p>
      )}
      <div className={styles.modes}>
        {MODES.map((item) => (
          <button
            key={item.type}
            type="button"
            className={cn(styles.mode, styles[`mode-${item.type}`], mode === item.type && styles.modeActive)}
            onClick={() => {
              decision.reset()
              setMode(mode === item.type ? null : item.type)
            }}
            aria-pressed={mode === item.type}
          >
            <span className={styles.modeIcon}>{item.icon}</span>
            <span>{item.label}</span>
            {recommended === item.type && <em className={styles.recommended}>рекомендовано</em>}
          </button>
        ))}
      </div>
      {decision.error && (
        <Alert tone="danger" title="Решение не отправлено">
          {decision.error instanceof ApiError ? decision.error.message : 'Попробуйте ещё раз'}
        </Alert>
      )}
      {FormComponent && mode && (
        <FormComponent
          key={mode}
          application={application}
          submitting={decision.isPending}
          onCancel={() => setMode(null)}
          onSubmit={(body) =>
            decision.mutate(body, {
              onSuccess: () => {
                setMode(null)
                onDecided()
              },
            })
          }
        />
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ApiError, type Application, type CompanyInsights, type Financials, type TaxSystem } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { formatMonthLong } from '@/shared/lib/dates'
import { taxSystemLabels } from '@/shared/lib/labels'
import { Alert, Field, Select } from '@/shared/ui'
import { FinancialsOverview } from '../wizard/FinancialsOverview'
import { MoneyInput } from '../wizard/MoneyInput'
import type { StepNav } from '../wizard/types'
import { usePatchApplication } from '../wizard/useWizardData'
import { WizardFooter } from '../wizard/WizardFooter'
import styles from './Steps.module.css'

const MAX_MONEY = 100_000_000_000
const money = (label: string) =>
  z
    .number({ invalid_type_error: `Укажите ${label}` })
    .min(0, 'Значение не может быть отрицательным')
    .max(MAX_MONEY, 'Слишком большое значение')

const schema = z
  .object({
    revenue_12m: money('выручку').positive('Выручка должна быть больше нуля'),
    revenue_m1: money('выручку за месяц'),
    revenue_m2: money('выручку за месяц'),
    revenue_m3: money('выручку за месяц'),
    expenses_12m: money('расходы'),
    net_profit_12m: z
      .number({ invalid_type_error: 'Укажите чистую прибыль' })
      .min(-MAX_MONEY, 'Слишком большое значение')
      .max(MAX_MONEY, 'Слишком большое значение'),
    monthly_debt_payments: money('платежи по кредитам'),
    employees_count: z
      .number({ invalid_type_error: 'Укажите число сотрудников' })
      .int('Укажите целое число')
      .min(0, 'Значение не может быть отрицательным')
      .max(100_000, 'Слишком большое значение'),
    tax_system: z.enum(['USN_6', 'USN_15', 'OSN', 'PATENT'], { errorMap: () => ({ message: 'Выберите налоговый режим' }) }),
  })
  .superRefine((values, context) => {
    if (values.revenue_m1 + values.revenue_m2 + values.revenue_m3 > values.revenue_12m) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revenue_m3'],
        message: 'Выручка за 3 месяца не может быть больше годовой',
      })
    }
    if (values.net_profit_12m > values.revenue_12m) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['net_profit_12m'],
        message: 'Прибыль не может быть больше выручки',
      })
    }
  })

type FormValues = z.infer<typeof schema>

function lastMonths(insights: CompanyInsights | undefined): string[] {
  const fromInsights = insights?.turnover.slice(-3).map((month) => month.month) ?? []
  if (fromInsights.length === 3) return fromInsights
  const now = new Date()
  return [3, 2, 1].map((offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}

function buildDefaults(application: Application, insights: CompanyInsights | undefined): { values: FormValues; fromAccount: boolean } {
  const saved = application.financials
  if (saved) {
    return {
      fromAccount: false,
      values: {
        revenue_12m: saved.revenue_12m,
        revenue_m1: saved.revenue_last_3m[0] ?? 0,
        revenue_m2: saved.revenue_last_3m[1] ?? 0,
        revenue_m3: saved.revenue_last_3m[2] ?? 0,
        expenses_12m: saved.expenses_12m,
        net_profit_12m: saved.net_profit_12m,
        monthly_debt_payments: saved.monthly_debt_payments,
        employees_count: saved.employees_count,
        tax_system: saved.tax_system,
      },
    }
  }
  const months = insights?.turnover.slice(-12) ?? []
  const revenue = months.reduce((sum, month) => sum + month.inflow, 0)
  const expenses = months.reduce((sum, month) => sum + month.outflow, 0)
  const last3 = months.slice(-3).map((month) => month.inflow)
  const debt = insights?.loans.reduce((sum, loan) => sum + loan.monthly_payment, 0) ?? 0
  return {
    fromAccount: months.length > 0,
    values: {
      revenue_12m: revenue,
      revenue_m1: last3[0] ?? 0,
      revenue_m2: last3[1] ?? 0,
      revenue_m3: last3[2] ?? 0,
      expenses_12m: expenses,
      net_profit_12m: revenue - expenses,
      monthly_debt_payments: debt,
      employees_count: application.company.employees_count,
      tax_system: application.company.tax_system,
    },
  }
}

function toFinancials(values: FormValues): Financials {
  return {
    revenue_12m: values.revenue_12m,
    revenue_last_3m: [values.revenue_m1, values.revenue_m2, values.revenue_m3],
    expenses_12m: values.expenses_12m,
    net_profit_12m: values.net_profit_12m,
    monthly_debt_payments: values.monthly_debt_payments,
    employees_count: values.employees_count,
    tax_system: values.tax_system,
  }
}

const TAX_SYSTEMS: TaxSystem[] = ['USN_6', 'USN_15', 'OSN', 'PATENT']

interface FinancialsStepProps {
  application: Application
  insights: CompanyInsights | undefined
  nav: StepNav
}

export function FinancialsStep({ application, insights, nav }: FinancialsStepProps) {
  const initial = useMemo(() => buildDefaults(application, insights), [application, insights])
  const months = useMemo(() => lastMonths(insights), [insights])
  const patch = usePatchApplication(application.id)
  const [editing, setEditing] = useState(!initial.fromAccount && !application.financials)
  const { control, handleSubmit, watch, setValue, getFieldState, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial.values,
    mode: 'onTouched',
  })
  const { errors } = formState

  useEffect(() => {
    const subscription = watch((values, { name, type }) => {
      if (type !== 'change' || (name !== 'revenue_12m' && name !== 'expenses_12m')) return
      if (getFieldState('net_profit_12m').isDirty) return
      setValue('net_profit_12m', (values.revenue_12m ?? 0) - (values.expenses_12m ?? 0), { shouldValidate: true })
    })
    return () => subscription.unsubscribe()
  }, [watch, setValue, getFieldState])

  const revenue = watch('revenue_12m')
  const expenses = watch('expenses_12m')
  const profit = watch('net_profit_12m')
  const debt = watch('monthly_debt_payments')

  useAssistantScreen({
    screen: 'wizard.financials',
    title: 'Заявка: финансовые показатели',
    applicationId: application.id,
    data: {
      revenue_12m: revenue,
      expenses_12m: expenses,
      net_profit_12m: profit,
      monthly_debt_payments: debt,
      prefilled_from_account: initial.fromAccount,
    },
    suggestions: ['Где взять выручку за 12 месяцев?', 'Что считать платежами по кредитам?', 'Почему поля уже заполнены?'],
  })

  const save = (after: () => void) => (values: FormValues) => {
    patch.mutate({ financials: toFinancials(values) }, { onSuccess: after })
  }

  const moneyField = (
    name: FieldPath<FormValues>,
    label: string,
    hint?: string,
    question?: string,
    allowNegative?: boolean,
    row = true,
  ) => (
    <Field
      key={name}
      label={label}
      hint={hint}
      error={errors[name]?.message}
      assist={name}
      className={row ? styles.fieldRow : undefined}
      help={question ? <AskButton question={question} /> : undefined}
    >
      {(id) => (
        <Controller
          control={control}
          name={name}
          render={({ field, fieldState }) => (
            <MoneyInput
              id={id}
              value={typeof field.value === 'number' ? field.value : undefined}
              onChange={field.onChange}
              onBlur={field.onBlur}
              invalid={Boolean(fieldState.error)}
              allowNegative={allowNegative}
            />
          )}
        />
      )}
    </Field>
  )

  return (
    <form className={styles.stack} onSubmit={handleSubmit(save(nav.next))} noValidate>
      {editing ? (
        <>
          {!initial.fromAccount && !application.financials && (
            <Alert tone="neutral" title="Заполните показатели вручную">
              У банка пока нет выписки по вашему счёту. Возьмите цифры из бухгалтерии или налоговой декларации — банк сверит их с данными ФНС.
            </Alert>
          )}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Выручка и расходы</h3>
            <div className={styles.formRows}>
              {moneyField('revenue_12m', 'Выручка за 12 месяцев', 'Все поступления от продаж, без кредитов и займов', 'Что считать выручкой за 12 месяцев?')}
              {moneyField('expenses_12m', 'Расходы за 12 месяцев', 'Закупки, зарплаты, аренда, налоги', 'Какие расходы учитывать?')}
              <div className={styles.monthsRow} data-assist="revenue_last_3m">
                <div className={styles.monthsLabel}>
                  <span>Выручка за последние 3 месяца</span>
                  <span>Помогает увидеть динамику</span>
                </div>
                <div className={styles.monthsGrid}>
                  {(['revenue_m1', 'revenue_m2', 'revenue_m3'] as const).map((name, index) =>
                    moneyField(name, formatMonthLong(months[index] ?? ''), undefined, undefined, false, false),
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Прибыль и нагрузка</h3>
            <div className={styles.formRows}>
              {moneyField(
                'net_profit_12m',
                'Чистая прибыль за 12 месяцев',
                'Подставили выручку минус расходы — можно поправить',
                'Как посчитать чистую прибыль?',
                true,
              )}
              {moneyField(
                'monthly_debt_payments',
                'Платежи по текущим кредитам в месяц',
                'Кредиты, лизинг, займы — во всех банках',
                'Что считать платежами по текущим кредитам?',
              )}
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>О компании</h3>
            <div className={styles.formRows}>
              <Field label="Число сотрудников" error={errors.employees_count?.message} assist="employees_count" className={styles.fieldRow}>
                {(id) => (
                  <Controller
                    control={control}
                    name="employees_count"
                    render={({ field, fieldState }) => (
                      <MoneyInput
                        id={id}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        invalid={Boolean(fieldState.error)}
                        suffix="чел."
                      />
                    )}
                  />
                )}
              </Field>
              <Field
                label="Система налогообложения"
                error={errors.tax_system?.message}
                assist="tax_system"
                className={styles.fieldRow}
                help={<AskButton question="Как налоговый режим влияет на рассмотрение заявки?" />}
              >
                {(id) => (
                  <Controller
                    control={control}
                    name="tax_system"
                    render={({ field }) => (
                      <Select id={id} value={field.value} onChange={(event) => field.onChange(event.target.value)} onBlur={field.onBlur}>
                        {TAX_SYSTEMS.map((tax) => (
                          <option key={tax} value={tax}>
                            {taxSystemLabels[tax]}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                )}
              </Field>
            </div>
          </section>
        </>
      ) : (
        <FinancialsOverview
          values={watch()}
          turnover={insights?.turnover ?? []}
          fromAccount={initial.fromAccount}
          onEdit={() => setEditing(true)}
        />
      )}

      {patch.error && (
        <Alert tone="danger" title="Не удалось сохранить">
          {patch.error instanceof ApiError ? patch.error.message : 'Попробуйте ещё раз'}
        </Alert>
      )}

      <WizardFooter
        onBack={() => void handleSubmit(save(nav.back), () => nav.back())()}
        nextType="submit"
        loading={patch.isPending}
      />
    </form>
  )
}

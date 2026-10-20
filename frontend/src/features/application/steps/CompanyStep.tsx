import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Building2, Search } from 'lucide-react'
import { ApiError, companyApi, type Application, type CompanyLookup } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { cn } from '@/shared/lib/cn'
import { formatBusinessAge, formatDate } from '@/shared/lib/dates'
import { legalFormLabels, taxSystemLabels } from '@/shared/lib/labels'
import { Alert, Button, Checkbox, Field, Input } from '@/shared/ui'
import type { StepNav } from '../wizard/types'
import { usePatchApplication } from '../wizard/useWizardData'
import { WizardFooter } from '../wizard/WizardFooter'
import styles from './Steps.module.css'

const INN_PATTERN = /^(\d{10}|\d{12})$/

function CompanyData({ company }: { company: CompanyLookup }) {
  const cells: { label: string; value: string; wide?: boolean }[] = [
    { label: 'ОГРН', value: company.ogrn },
    { label: 'ИНН', value: company.inn },
    {
      label: 'Дата регистрации',
      value: `${formatDate(company.registration_date)} · ${formatBusinessAge(company.registration_date)}`,
    },
    { label: 'Налоговый режим', value: taxSystemLabels[company.tax_system] },
    { label: 'Основной ОКВЭД', value: `${company.okved_main} — ${company.okved_name}`, wide: true },
    { label: 'Руководитель', value: company.head_name },
    { label: 'Сотрудников', value: String(company.employees_count) },
    { label: 'Юридический адрес', value: company.address, wide: true },
  ]
  return (
    <div className={styles.company} data-assist="company-data">
      <div className={styles.companyHeader}>
        <span className={styles.companyAvatar}>
          <Building2 size={22} />
        </span>
        <div className={styles.companyTitle}>
          <strong>{company.name}</strong>
          <span>{legalFormLabels[company.legal_form]}</span>
        </div>
      </div>
      <dl className={styles.facts}>
        {cells.map((cell) => (
          <div key={cell.label} className={cn(cell.wide && styles.factWide)}>
            <dt>{cell.label}</dt>
            <dd>{cell.value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.companySource}>Данные из ЕГРЮЛ — менять их не нужно. Если что-то устарело, обновите сведения в налоговой.</p>
    </div>
  )
}

export function CompanyStep({ application, nav }: { application: Application; nav: StepNav }) {
  const [inn, setInn] = useState(application.company.inn)
  const [innError, setInnError] = useState<string | undefined>()
  const [confirmed, setConfirmed] = useState(application.company_confirmed)
  const [confirmError, setConfirmError] = useState<string | undefined>()
  const [checked, setChecked] = useState<CompanyLookup | null>(null)
  const patch = usePatchApplication(application.id)
  const lookup = useMutation({
    mutationFn: companyApi.lookup,
    onSuccess: (company) => setChecked(company),
  })

  const shown: CompanyLookup = checked ?? application.company
  const mismatch = checked !== null && checked.inn !== application.company.inn

  useAssistantScreen({
    screen: 'wizard.company',
    title: 'Заявка: данные компании',
    applicationId: application.id,
    data: {
      inn,
      company_name: shown.name,
      company_confirmed: confirmed,
      registration_date: shown.registration_date,
      okved: shown.okved_main,
    },
    suggestions: ['Зачем проверять ИНН?', 'Что делать, если данные неверны?', 'Откуда эти данные?'],
  })

  function runLookup() {
    const value = inn.trim()
    if (!INN_PATTERN.test(value)) {
      setInnError('ИНН состоит из 10 цифр для организации или 12 цифр для ИП')
      return
    }
    setInnError(undefined)
    lookup.mutate(value)
  }

  function submit() {
    if (mismatch) {
      setConfirmError('Заявка подаётся от компании из профиля — ИНН должен совпадать')
      return
    }
    if (!confirmed) {
      setConfirmError('Подтвердите, что данные компании верны')
      return
    }
    setConfirmError(undefined)
    if (application.company_confirmed) {
      nav.next()
      return
    }
    patch.mutate({ company_confirmed: true }, { onSuccess: () => nav.next() })
  }

  return (
    <div className={styles.stack}>
      <div className={styles.innRow}>
        <Field
          label="ИНН компании"
          assist="inn"
          error={innError}
          hint="Предзаполнен из профиля. Проверим по ЕГРЮЛ и подтянем реквизиты."
          help={<AskButton question="Зачем банку проверять ИНН и что такое ЕГРЮЛ?" />}
        >
          {(id) => (
            <Input
              id={id}
              value={inn}
              inputMode="numeric"
              maxLength={12}
              invalid={Boolean(innError)}
              onChange={(event) => setInn(event.target.value.replace(/\D/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  runLookup()
                }
              }}
            />
          )}
        </Field>
        <Button variant="secondary" icon={<Search size={17} />} onClick={runLookup} loading={lookup.isPending} className={styles.innButton}>
          Проверить
        </Button>
      </div>

      {lookup.error && (
        <Alert tone="danger" title="Компания не найдена">
          {lookup.error instanceof ApiError ? lookup.error.message : 'Проверьте ИНН и попробуйте ещё раз'}
        </Alert>
      )}

      {checked && !mismatch && (
        <Alert tone="success" title="Данные получены из ЕГРЮЛ">
          Реквизиты совпадают с профилем компании — менять их не нужно.
        </Alert>
      )}

      {mismatch && (
        <Alert tone="warning" title="ИНН отличается от компании в профиле">
          Заявка оформляется от имени «{application.company.name}». Чтобы подать заявку от другой компании, войдите под её учётной
          записью.
        </Alert>
      )}

      <CompanyData company={shown} />

      <div className={styles.confirm} data-assist="company-confirm">
        <Checkbox
          label="Данные компании верны"
          description="Подтверждаю, что реквизиты актуальны и я вправе подавать заявку от имени компании"
          checked={confirmed}
          invalid={Boolean(confirmError)}
          onChange={(event) => {
            setConfirmed(event.target.checked)
            if (event.target.checked) setConfirmError(undefined)
          }}
        />
        {confirmError && <span className={styles.error}>{confirmError}</span>}
      </div>

      {patch.error && (
        <Alert tone="danger" title="Не удалось сохранить">
          {patch.error instanceof ApiError ? patch.error.message : 'Попробуйте ещё раз'}
        </Alert>
      )}

      <WizardFooter
        onBack={() => {
          if (confirmed && !mismatch && !application.company_confirmed) patch.mutate({ company_confirmed: true }, { onSettled: nav.back })
          else nav.back()
        }}
        onNext={submit}
        loading={patch.isPending}
      />
    </div>
  )
}

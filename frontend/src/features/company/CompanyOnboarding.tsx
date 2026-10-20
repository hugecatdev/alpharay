import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Building2, Search } from 'lucide-react'
import { ApiError, companyApi, type CompanyLookup } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { formatBusinessAge, formatDate } from '@/shared/lib/dates'
import { legalFormLabels, taxSystemLabels } from '@/shared/lib/labels'
import { Alert, Button, Field, Input, KeyValueList } from '@/shared/ui'
import { useLinkCompany } from './useCompany'
import styles from './CompanyOnboarding.module.css'

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'Не нашли компанию с таким ИНН в ЕГРЮЛ и ЕГРИП. Проверьте цифры.'
    return error.message
  }
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.'
}

export function CompanyOnboarding({ title = 'Добавьте компанию' }: { title?: string }) {
  const [inn, setInn] = useState('')
  const [found, setFound] = useState<CompanyLookup | null>(null)
  const lookup = useMutation({ mutationFn: (value: string) => companyApi.lookup(value), onSuccess: setFound })
  const link = useLinkCompany()

  useAssistantScreen({
    screen: 'onboarding',
    title: 'Добавление компании',
    data: { inn: inn || null, found: found?.name ?? null },
    suggestions: ['Где найти ИНН?', 'Что делать, если у меня нет ИП?', 'Чем ИП отличается от ООО для кредита?'],
  })

  const digits = inn.replace(/\D/g, '')
  const valid = digits.length === 10 || digits.length === 12

  function search(event: FormEvent) {
    event.preventDefault()
    if (!valid) return
    setFound(null)
    link.reset()
    lookup.mutate(digits)
  }

  return (
    <div className={styles.root}>
      <section className={styles.card}>
        <span className={styles.icon} aria-hidden>
          <Building2 size={26} />
        </span>
        <div className={styles.head}>
          <h2>{title}</h2>
          <p>Заявку на кредит подаёт ИП или юрлицо. Найдём реквизиты по ИНН в ЕГРЮЛ и ЕГРИП — вводить их вручную не придётся.</p>
        </div>

        <form className={styles.form} onSubmit={search}>
          <Field
            label="ИНН компании или ИП"
            hint="10 цифр у юрлица, 12 — у ИП"
            assist="company-inn"
            help={<AskButton question="Где найти ИНН моей компании или ИП?" />}
            className={styles.field}
          >
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="off"
                maxLength={14}
                placeholder="Например, 7714382915"
                value={inn}
                onChange={(event) => setInn(event.target.value.replace(/[^\d\s]/g, ''))}
              />
            )}
          </Field>
          <Button type="submit" size="lg" disabled={!valid} loading={lookup.isPending} icon={<Search size={18} />}>
            Найти
          </Button>
        </form>

        {lookup.isError && <Alert tone="warning">{errorText(lookup.error)}</Alert>}

        {found && (
          <div className={styles.found}>
            <div className={styles.foundHead}>
              <span className={styles.foundEyebrow}>{legalFormLabels[found.legal_form]}</span>
              <h3>{found.name}</h3>
            </div>
            <KeyValueList
              columns={1}
              items={[
                { label: 'ИНН', value: found.inn },
                { label: 'ОГРН', value: found.ogrn },
                { label: 'Регистрация', value: `${formatDate(found.registration_date)} · ${formatBusinessAge(found.registration_date)}` },
                { label: 'Налоги', value: taxSystemLabels[found.tax_system] },
                { label: 'ОКВЭД', value: `${found.okved_main} · ${found.okved_name}` },
                { label: 'Руководитель', value: found.head_name },
              ]}
            />
            {link.isError && <Alert tone="danger">{errorText(link.error)}</Alert>}
            <div className={styles.actions}>
              <Button size="lg" loading={link.isPending} iconRight={<ArrowRight size={18} />} onClick={() => link.mutate(found.inn)}>
                Это моя компания
              </Button>
              <Button variant="ghost" onClick={() => setFound(null)}>
                Другой ИНН
              </Button>
            </div>
          </div>
        )}
      </section>

      <section className={styles.aside}>
        <h3>Ещё нет ИП или ООО?</h3>
        <p>
          Кредит для бизнеса выдаётся только зарегистрированному предпринимателю или компании. Зарегистрировать ИП можно в ФНС — обычно это занимает
          около трёх рабочих дней.
        </p>
        <div className={styles.asideActions}>
          <AskButton variant="text" question="Что делать, если у меня ещё нет ИП или ООО, а деньги на бизнес нужны?">
            Спросить Рэя
          </AskButton>
        </div>
      </section>
    </div>
  )
}

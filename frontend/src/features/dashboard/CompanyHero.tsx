import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Company, User } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { formatBusinessAge } from '@/shared/lib/dates'
import { taxSystemLabels } from '@/shared/lib/labels'
import { formatMoneyShort } from '@/shared/lib/money'
import { ButtonLink, Card, Skeleton } from '@/shared/ui'
import styles from './Dashboard.module.css'

function firstName(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean)
  return (parts.length >= 3 ? parts[1] : parts[0]) ?? ''
}

function greeting(now: Date = new Date()): string {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'Доброе утро'
  if (hour >= 12 && hour < 18) return 'Добрый день'
  if (hour >= 18 && hour < 23) return 'Добрый вечер'
  return 'Доброй ночи'
}

export function CompanyHero({ user, company }: { user: User; company: Company | undefined }) {
  const name = firstName(user.full_name)
  return (
    <section className={styles.company} data-assist="company-card">
      <span className={styles.eyebrow}>Личный кабинет</span>
      <h1 className={styles.greeting}>
        {greeting()}
        {name ? `, ${name}` : ''}
      </h1>
      {company ? (
        <>
          <Link to="/app/company" className={styles.companyName}>
            {company.name}
            <ArrowUpRight size={18} strokeWidth={2.4} aria-hidden />
          </Link>
          <dl className={styles.companyFacts}>
            <div>
              <dt>ИНН</dt>
              <dd className="tabular">{company.inn}</dd>
            </div>
            <div>
              <dt>ОКВЭД</dt>
              <dd title={company.okved_name}>
                {company.okved_main} · {company.okved_name}
              </dd>
            </div>
            <div>
              <dt>Возраст бизнеса</dt>
              <dd>{formatBusinessAge(company.registration_date)}</dd>
            </div>
            <div>
              <dt>Налоги</dt>
              <dd>{taxSystemLabels[company.tax_system]}</dd>
            </div>
          </dl>
        </>
      ) : (
        <div className={styles.heroSkeleton}>
          <Skeleton height={24} width="55%" />
          <Skeleton height={44} />
        </div>
      )}
    </section>
  )
}

export function FinancingCta({ limit, loading }: { limit: number; loading: boolean }) {
  return (
    <Card
      eyebrow="Финансирование"
      title="Нужно финансирование?"
      assist="new-application"
      actions={<AskButton question="Как рассчитан предварительный лимит и сколько мне безопасно взять?" />}
    >
      <div className={styles.offerRow}>
        <div className={styles.offerFigure}>
          {loading ? (
            <Skeleton height={52} width={260} />
          ) : limit > 0 ? (
            <>
              <span className={styles.offerLabel}>Предварительно доступно до</span>
              <strong className="tabular">{formatMoneyShort(limit)}</strong>
              <span className={styles.offerNote}>По оборотам вашего счёта. Ориентир, а не решение банка.</span>
            </>
          ) : (
            <span className={styles.offerText}>Подберём продукт под задачу: оборотные средства, кассовый разрыв или оборудование.</span>
          )}
        </div>
        <ButtonLink to="/app/applications/new" variant="primary" size="lg" iconRight={<ArrowUpRight size={18} />}>
          Подобрать кредит
        </ButtonLink>
      </div>
    </Card>
  )
}

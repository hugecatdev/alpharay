import { FileText } from 'lucide-react'
import type { Application } from '@/api'
import { documentKindLabels, purposeLabels, taxSystemLabels } from '@/shared/lib/labels'
import { formatFileSize, formatMoney } from '@/shared/lib/money'
import { Card, KeyValueList } from '@/shared/ui'
import styles from './DetailsCard.module.css'

export function DetailsCard({ application }: { application: Application }) {
  const { company, financials } = application
  const purpose = application.purpose_type ? purposeLabels[application.purpose_type].title : null

  return (
    <Card title="Данные заявки">
      <KeyValueList
        items={[
          { label: 'Продукт', value: application.product.name },
          ...(purpose ? [{ label: 'Направление', value: purpose }] : []),
          ...(application.purpose ? [{ label: 'Цель', value: application.purpose }] : []),
          { label: 'Компания', value: company.name },
          { label: 'ИНН', value: company.inn },
        ]}
      />
      {financials && (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Финансы</span>
          <KeyValueList
            items={[
              { label: 'Выручка за 12 мес.', value: formatMoney(financials.revenue_12m) },
              { label: 'Чистая прибыль', value: formatMoney(financials.net_profit_12m) },
              { label: 'Платежи по кредитам', value: `${formatMoney(financials.monthly_debt_payments)} / мес.` },
              { label: 'Налогообложение', value: taxSystemLabels[financials.tax_system] },
            ]}
          />
        </div>
      )}
      <div className={styles.section}>
        <span className={styles.sectionTitle}>Документы</span>
        {application.documents.length ? (
          <ul className={styles.docs}>
            {application.documents.map((document) => (
              <li key={document.id}>
                <FileText size={16} className={styles.docIcon} />
                <span className={styles.docName}>
                  {document.filename}
                  <small>{documentKindLabels[document.kind]}</small>
                </span>
                <span className={styles.docSize}>{formatFileSize(document.size)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>Документы не загружались — банк использует данные вашего счёта и внешних источников.</p>
        )}
      </div>
    </Card>
  )
}

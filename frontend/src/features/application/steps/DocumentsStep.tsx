import { useRef, useState, type DragEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, Landmark, Paperclip, ShieldCheck, Trash2, UploadCloud } from 'lucide-react'
import { ApiError, applicationsApi, queryKeys, type Application, type DocumentKind } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { useAssistantScreen } from '@/features/assistant/AssistantProvider'
import { cn } from '@/shared/lib/cn'
import { formatDateTime } from '@/shared/lib/dates'
import { documentKindLabels } from '@/shared/lib/labels'
import { formatFileSize } from '@/shared/lib/money'
import { Alert, Field, IconButton, Select } from '@/shared/ui'
import type { StepNav } from '../wizard/types'
import { WizardFooter } from '../wizard/WizardFooter'
import styles from './Steps.module.css'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const KINDS: DocumentKind[] = ['BANK_STATEMENT', 'TAX_RETURN', 'EQUIPMENT_INVOICE', 'OTHER']

export function DocumentsStep({ application, nav }: { application: Application; nav: StepNav }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const requiresInvoice = application.product.requires_invoice
  const hasInvoice = application.documents.some((document) => document.kind === 'EQUIPMENT_INVOICE')
  const [kind, setKind] = useState<DocumentKind>(requiresInvoice && !hasInvoice ? 'EQUIPMENT_INVOICE' : 'BANK_STATEMENT')
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.application(application.id) })

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) await applicationsApi.uploadDocument(application.id, kind, file)
    },
    onSettled: refresh,
    onSuccess: () => {
      if (kind === 'EQUIPMENT_INVOICE') setKind('BANK_STATEMENT')
      setBlocked(false)
    },
  })

  const remove = useMutation({
    mutationFn: (documentId: string) => applicationsApi.deleteDocument(application.id, documentId),
    onSettled: refresh,
  })

  useAssistantScreen({
    screen: 'wizard.documents',
    title: 'Заявка: документы',
    applicationId: application.id,
    data: {
      documents_count: application.documents.length,
      requires_invoice: requiresInvoice,
      has_invoice: hasInvoice,
      product_code: application.product.code,
    },
    suggestions: ['Какие документы нужны?', 'Зачем счёт на оборудование?', 'Можно отправить без документов?'],
  })

  function handleFiles(list: FileList | null) {
    if (!list || !list.length) return
    const files = Array.from(list)
    const tooBig = files.find((file) => file.size > MAX_FILE_SIZE)
    if (tooBig) {
      setLocalError(`Файл «${tooBig.name}» больше 15 МБ`)
      return
    }
    setLocalError(null)
    upload.mutate(files)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  function submit() {
    if (requiresInvoice && !hasInvoice) {
      setBlocked(true)
      return
    }
    nav.next()
  }

  const uploadError = upload.error ?? remove.error

  return (
    <div className={styles.stack}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionTitle}>
            Что нужно для рассмотрения
            <AskButton question="Какие документы нужны для этой заявки и зачем?" />
          </h3>
        </div>
        <ul className={styles.checklist}>
          <li className={styles.checkRow}>
            <span className={cn(styles.checkIcon, styles.checkDone)}>
              <Landmark size={16} />
            </span>
            <span className={styles.checkText}>
              Выписка по расчётному счёту в AlphaRay
              <small>Уже есть у банка</small>
            </span>
            <Check size={18} color="var(--green-strong)" />
          </li>
          <li className={styles.checkRow}>
            <span className={cn(styles.checkIcon, styles.checkDone)}>
              <ShieldCheck size={16} />
            </span>
            <span className={styles.checkText}>
              Сведения ФНС и бюро кредитных историй
              <small>Достаточно вашего согласия на последнем шаге</small>
            </span>
            <Check size={18} color="var(--green-strong)" />
          </li>
          {requiresInvoice && (
            <li className={styles.checkRow} data-assist="doc-EQUIPMENT_INVOICE">
              <span className={cn(styles.checkIcon, hasInvoice ? styles.checkDone : styles.checkMissing)}>
                <FileText size={16} />
              </span>
              <span className={styles.checkText}>
                Счёт на оборудование — обязательно
                <small>{hasInvoice ? 'Загружен' : 'Счёт или коммерческое предложение поставщика'}</small>
              </span>
              {hasInvoice ? <Check size={18} color="var(--green-strong)" /> : null}
            </li>
          )}
          <li className={styles.checkRow}>
            <span className={styles.checkIcon}>
              <Paperclip size={16} />
            </span>
            <span className={styles.checkText}>
              Выписки из других банков, декларации
              <small>По желанию — если часть выручки идёт через другие банки</small>
            </span>
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.uploadRow}>
          <Field label="Тип документа">
            {(id) => (
              <Select id={id} value={kind} onChange={(event) => setKind(event.target.value as DocumentKind)}>
                {KINDS.map((item) => (
                  <option key={item} value={item}>
                    {documentKindLabels[item]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <span className={styles.muted}>PDF, JPG или PNG до 15 МБ. Можно выбрать несколько файлов.</span>
        </div>
        <div
          className={cn(styles.dropzone, dragging && styles.dropzoneActive)}
          data-assist="documents-upload"
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className={styles.dropIcon}>
            <UploadCloud size={22} />
          </span>
          <span className={styles.dropTitle}>{upload.isPending ? 'Загружаем…' : 'Перетащите файлы сюда'}</span>
          <span className={styles.muted}>или нажмите, чтобы выбрать · тип: {documentKindLabels[kind]}</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            onChange={(event) => {
              handleFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
        {localError && <Alert tone="danger">{localError}</Alert>}
        {uploadError && (
          <Alert tone="danger" title="Не удалось обработать файл">
            {uploadError instanceof ApiError ? uploadError.message : 'Попробуйте ещё раз'}
          </Alert>
        )}
      </section>

      <section className={styles.section} data-assist="documents-list">
        <h3 className={styles.sectionTitle}>Загружено: {application.documents.length}</h3>
        {application.documents.length === 0 ? (
          <p className={styles.muted}>Пока ничего не загружено.</p>
        ) : (
          <ul className={styles.docList}>
            {application.documents.map((document) => (
              <li key={document.id} className={styles.docItem}>
                <span className={styles.docIcon}>
                  <FileText size={17} />
                </span>
                <span className={styles.docText}>
                  <strong title={document.filename}>{document.filename}</strong>
                  <span>
                    {documentKindLabels[document.kind]} · {formatFileSize(document.size)} · {formatDateTime(document.created_at)}
                  </span>
                </span>
                <IconButton
                  label={`Удалить ${document.filename}`}
                  onClick={() => remove.mutate(document.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 size={17} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      {blocked && requiresInvoice && !hasInvoice && (
        <Alert tone="warning" title="Загрузите счёт на оборудование">
          Без счёта банк не сможет рассмотреть кредит на покупку оборудования. Выберите тип «Счёт на оборудование» и добавьте файл.
        </Alert>
      )}

      <WizardFooter onBack={nav.back} onNext={submit} />
    </div>
  )
}

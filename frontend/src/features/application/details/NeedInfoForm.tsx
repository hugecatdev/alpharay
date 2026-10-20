import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { FileCheck2, Paperclip, Send, X } from 'lucide-react'
import { ApiError, applicationsApi, type Application, type InfoRequest, type InfoRequestItem } from '@/api'
import { AskButton } from '@/features/assistant/AskButton'
import { formatFileSize, formatNumber, parseMoneyInput } from '@/shared/lib/money'
import { Alert, Button, Field, Input, Textarea } from '@/shared/ui'
import { documentKindFor } from './format'
import { useApplicationCache } from './useApplication'
import styles from './NeedInfoForm.module.css'

type Values = Record<string, string>

function buildSchema(items: InfoRequestItem[]) {
  return z.record(z.string(), z.string()).superRefine((values, ctx) => {
    for (const item of items) {
      const value = (values[item.code] ?? '').trim()
      if (item.type === 'document' && !value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [item.code], message: 'Загрузите файл' })
      } else if (item.type === 'number' && parseMoneyInput(value) <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [item.code], message: 'Укажите сумму в рублях' })
      } else if (item.type === 'text' && value.length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [item.code], message: 'Заполните поле' })
      }
    }
  })
}

interface UploadState {
  name: string
  size: number
  uploading: boolean
  error: string | null
}

function DocumentInput({
  applicationId,
  item,
  error,
  onUploaded,
  onCleared,
  onBusyChange,
}: {
  applicationId: string
  item: InfoRequestItem
  error?: string
  onUploaded: (filename: string) => void
  onCleared: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [upload, setUpload] = useState<UploadState | null>(null)

  async function handleFile(file: File) {
    setUpload({ name: file.name, size: file.size, uploading: true, error: null })
    onBusyChange(true)
    try {
      const document = await applicationsApi.uploadDocument(applicationId, documentKindFor(item.code), file)
      setUpload({ name: document.filename, size: document.size, uploading: false, error: null })
      onUploaded(document.filename)
    } catch (uploadError) {
      const message = uploadError instanceof ApiError ? uploadError.message : 'Не удалось загрузить файл'
      setUpload({ name: file.name, size: file.size, uploading: false, error: message })
      onCleared()
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <Field label={item.label} error={error ?? upload?.error ?? undefined} assist={`info-${item.code}`}>
      {(id) => (
        <div className={styles.upload}>
          <input
            ref={inputRef}
            id={id}
            type="file"
            className={styles.fileInput}
            accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv,.doc,.docx"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
              event.target.value = ''
            }}
          />
          {upload && !upload.error ? (
            <div className={styles.fileRow}>
              <FileCheck2 size={18} className={styles.fileIcon} />
              <span className={styles.fileName}>{upload.name}</span>
              <span className={styles.fileSize}>{upload.uploading ? 'загружаем…' : formatFileSize(upload.size)}</span>
              {!upload.uploading && (
                <button
                  type="button"
                  className={styles.fileRemove}
                  aria-label="Убрать файл"
                  onClick={() => {
                    setUpload(null)
                    onCleared()
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ) : (
            <Button variant="secondary" icon={<Paperclip size={16} />} onClick={() => inputRef.current?.click()}>
              Выбрать файл
            </Button>
          )}
        </div>
      )}
    </Field>
  )
}

export function NeedInfoForm({ application, request }: { application: Application; request: InfoRequest }) {
  const updateCache = useApplicationCache(application.id)
  const [busyUploads, setBusyUploads] = useState(0)
  const defaults: Values = Object.fromEntries(request.items.map((item) => [item.code, '']))
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(buildSchema(request.items)), defaultValues: defaults })

  const respond = useMutation({
    mutationFn: (values: Values) =>
      applicationsApi.respondInfo(
        application.id,
        request.id,
        request.items.map((item) => ({
          code: item.code,
          value: item.type === 'number' ? String(parseMoneyInput(values[item.code] ?? '')) : (values[item.code] ?? '').trim(),
        })),
      ),
    onSuccess: updateCache,
  })

  return (
    <form className={styles.form} onSubmit={handleSubmit((values) => respond.mutate(values))} data-assist="info-request" noValidate>
      <Alert
        tone="warning"
        title="Банку нужно немного больше данных"
        actions={<AskButton variant="text" question="Зачем банку эти данные и что будет после того, как я их отправлю?">Зачем это нужно?</AskButton>}
      >
        {request.comment || 'Дополните заявку — после отправки рассмотрение продолжится автоматически.'}
      </Alert>
      <div className={styles.items}>
        {request.items.map((item) => {
          const error = errors[item.code]?.message
          if (item.type === 'document') {
            register(item.code)
            return (
              <DocumentInput
                key={item.code}
                applicationId={application.id}
                item={item}
                error={error}
                onUploaded={(filename) => setValue(item.code, filename, { shouldValidate: true })}
                onCleared={() => setValue(item.code, '', { shouldValidate: false })}
                onBusyChange={(busy) => setBusyUploads((count) => Math.max(0, count + (busy ? 1 : -1)))}
              />
            )
          }
          if (item.type === 'number') {
            const field = register(item.code)
            return (
              <Field key={item.code} label={item.label} error={error} assist={`info-${item.code}`}>
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    placeholder="0"
                    suffix="₽"
                    invalid={Boolean(error)}
                    {...field}
                    onChange={(event) => {
                      const digits = parseMoneyInput(event.target.value)
                      event.target.value = digits ? formatNumber(digits) : ''
                      void field.onChange(event)
                    }}
                  />
                )}
              </Field>
            )
          }
          return (
            <Field key={item.code} label={item.label} error={error} assist={`info-${item.code}`}>
              {(id) => <Textarea id={id} rows={3} placeholder="Опишите коротко" invalid={Boolean(error)} {...register(item.code)} />}
            </Field>
          )
        })}
      </div>
      {respond.isError && (
        <Alert tone="danger" title="Не удалось отправить ответ">
          {respond.error instanceof Error ? respond.error.message : 'Попробуйте ещё раз'}
        </Alert>
      )}
      <div className={styles.footer}>
        <Button type="submit" loading={respond.isPending} disabled={busyUploads > 0} iconRight={<Send size={16} />}>
          Отправить банку
        </Button>
        <span className={styles.note}>После отправки заявка снова пройдёт автоматическую проверку.</span>
      </div>
    </form>
  )
}

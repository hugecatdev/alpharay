import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CornerDownRight, Crosshair, Minimize2, RotateCcw, SendHorizontal, SlidersHorizontal, Sparkles } from 'lucide-react'
import type { AssistantAction } from '@/api'
import { cn } from '@/shared/lib/cn'
import { formatMoney } from '@/shared/lib/money'
import { IconButton } from '@/shared/ui'
import { Markdown } from './Markdown'
import { useAssistant, type ChatItem } from './AssistantProvider'
import styles from './AssistantPanel.module.css'

function describeAction(action: AssistantAction): string {
  const parts: string[] = []
  if (action.amount !== null) parts.push(formatMoney(action.amount))
  if (action.term !== null) parts.push(`${action.term} мес.`)
  return parts.join(' · ')
}

function fallbackFor(pathname: string): { to: string; label: string } | null {
  if (pathname.startsWith('/app/applications/')) return null
  if (pathname.startsWith('/app/applications')) return { to: '/app/applications/new', label: 'Оформить заявку формой' }
  if (pathname === '/app' || pathname === '/app/') return { to: '/app/applications', label: 'Открыть мои заявки' }
  return null
}

function Message({ item, onHint }: { item: ChatItem; onHint: (target: string) => void }) {
  const { pathname } = useLocation()
  const fallback = item.failed ? fallbackFor(pathname) : null
  if (item.role === 'user') {
    return (
      <div className={cn(styles.message, styles.user)}>
        <p>{item.content}</p>
      </div>
    )
  }
  return (
    <div className={cn(styles.message, styles.bot, item.failed && styles.failed)}>
      <Markdown source={item.content} />
      {fallback && (
        <Link to={fallback.to} className={styles.fallbackLink}>
          {fallback.label}
        </Link>
      )}
      {item.actions.length > 0 && (
        <p className={cn(styles.action, item.applied === false && styles.actionMissed)}>
          <SlidersHorizontal size={15} aria-hidden />
          {item.applied === false
            ? `Не подставлено: откройте шаг «Сумма и срок» — ${item.actions.map(describeAction).join(', ')}`
            : `Подставлено в форму: ${item.actions.map(describeAction).join(', ')}`}
        </p>
      )}
      {item.hints.length > 0 && (
        <div className={styles.hints}>
          {item.hints.map((hint) => (
            <button key={hint.target + hint.label} type="button" className={styles.hint} onClick={() => onHint(hint.target)}>
              <Crosshair size={15} aria-hidden />
              {hint.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AssistantPanel() {
  const { open, setOpen, messages, sending, send, suggestions, highlight, reset } = useAssistant()
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [messages.length, sending, open])

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!draft.trim() || sending) return
    send(draft)
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.launcher} onClick={() => setOpen(true)} aria-label="Открыть Рэя — ассистента">
        <span className={styles.launcherIcon}>
          <Sparkles size={24} strokeWidth={2.2} />
        </span>
        <span>Рэй</span>
      </button>
    )
  }

  return (
    <aside className={styles.panel} aria-label="Рэй — умный ассистент">
      <header className={styles.top}>
        <span className={styles.symbol} aria-hidden>
          <Sparkles size={28} strokeWidth={2} />
        </span>
        <div className={styles.titles}>
          <h3>Рэй</h3>
          <span>Ассистент</span>
        </div>
        <div className={styles.topActions}>
          {messages.length > 0 && (
            <IconButton label="Начать новый диалог" onClick={reset}>
              <RotateCcw size={17} />
            </IconButton>
          )}
          <IconButton label="Свернуть Рэя" onClick={() => setOpen(false)}>
            <Minimize2 size={17} />
          </IconButton>
        </div>
      </header>

      <div className={styles.conversation} ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <p className={styles.welcome}>
            Объясню термины, расчёты и риски на этом экране. Проверяете и отправляете заявку вы, решение принимает банк.
          </p>
        )}
        {messages.map((item) => (
          <Message key={item.id} item={item} onHint={highlight} />
        ))}
        {sending && (
          <div className={styles.typing}>
            Рэй печатает
            <span className={styles.dots} aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>

      <div className={styles.bottom}>
        <ul className={styles.suggestions}>
          {suggestions.slice(0, 3).map((suggestion) => (
            <li key={suggestion}>
              <button type="button" disabled={sending} onClick={() => send(suggestion)}>
                <CornerDownRight size={16} aria-hidden />
                <span>{suggestion}</span>
              </button>
            </li>
          ))}
        </ul>
        <form className={styles.input} onSubmit={submit} onClick={() => inputRef.current?.focus()}>
          <textarea
            ref={inputRef}
            rows={2}
            value={draft}
            maxLength={1000}
            placeholder="Спросите о том, что на экране"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Сообщение Рэю"
          />
          <button type="submit" disabled={!draft.trim() || sending} aria-label="Отправить">
            <SendHorizontal size={18} />
          </button>
        </form>
        <span className={styles.note}>Не принимает решений — условия определяет банк</span>
      </div>
    </aside>
  )
}

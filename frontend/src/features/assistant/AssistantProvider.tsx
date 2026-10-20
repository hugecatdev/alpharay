import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { assistantApi, type AssistantContext, type AssistantFieldValue, type AssistantMessage } from '@/api'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAssistantEnabled } from '@/shared/hooks/useConfig'
import { useLocalStorage } from '@/shared/hooks/useLocalStorage'

const SESSION_KEY = 'alpharay-assistant-session'

export const DEFAULT_SUGGESTIONS = ['Какой продукт мне подходит?', 'Что означает мой статус?', 'Сколько будет платёж?']

export interface ChatItem extends AssistantMessage {
  failed?: boolean
}

export interface ScreenContext {
  screen: string
  title: string
  applicationId?: string | null
  data?: Record<string, AssistantFieldValue>
  suggestions?: string[]
}

interface AssistantState {
  enabled: boolean
  open: boolean
  setOpen: (open: boolean) => void
  messages: ChatItem[]
  sending: boolean
  screen: ScreenContext
  suggestions: string[]
  send: (text: string) => void
  ask: (text: string) => void
  setScreen: (screen: ScreenContext) => void
  highlight: (target: string) => void
  reset: () => void
}

const AssistantStateContext = createContext<AssistantState | null>(null)

const DEFAULT_SCREEN: ScreenContext = { screen: 'app', title: 'Кредитный кабинет' }

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function writeSession(id: string | null) {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    return
  }
}

function localMessage(role: 'user' | 'assistant', content: string, failed?: boolean): ChatItem {
  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    hints: [],
    suggestions: [],
    created_at: new Date().toISOString(),
    failed,
  }
}

export function highlightElement(target: string) {
  const element = document.querySelector<HTMLElement>(`[data-assist="${CSS.escape(target)}"]`)
  if (!element) return false
  element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  element.setAttribute('data-assist-highlight', 'on')
  window.setTimeout(() => element.removeAttribute('data-assist-highlight'), 2800)
  return true
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const configEnabled = useAssistantEnabled()
  const enabled = configEnabled && user?.role === 'CLIENT'
  const location = useLocation()
  const [open, setOpen] = useLocalStorage('alpharay-assistant-open', true)
  const [messages, setMessages] = useState<ChatItem[]>([])
  const [sending, setSending] = useState(false)
  const [screen, setScreenState] = useState<ScreenContext>(DEFAULT_SCREEN)
  const sessionRef = useRef<string | null>(readSession())
  const screenRef = useRef(screen)
  const pathRef = useRef(location.pathname)
  screenRef.current = screen
  pathRef.current = location.pathname

  useEffect(() => {
    if (!enabled) return
    const id = sessionRef.current
    if (!id) return
    let cancelled = false
    assistantApi
      .session(id)
      .then((session) => {
        if (!cancelled) setMessages(session.messages)
      })
      .catch(() => {
        sessionRef.current = null
        writeSession(null)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  useEffect(() => {
    if (!user) {
      sessionRef.current = null
      setMessages([])
    }
  }, [user])

  const buildContext = useCallback((): AssistantContext => {
    const current = screenRef.current
    return {
      screen: current.screen,
      title: current.title,
      path: pathRef.current,
      application_id: current.applicationId ?? null,
      data: current.data ?? {},
    }
  }, [])

  const send = useCallback(
    (text: string) => {
      const message = text.trim()
      if (!message || sending) return
      setMessages((list) => [...list, localMessage('user', message)])
      setSending(true)
      assistantApi
        .chat({ session_id: sessionRef.current, message, context: buildContext() })
        .then((response) => {
          sessionRef.current = response.session_id
          writeSession(response.session_id)
          setMessages((list) => [...list, response.message])
        })
        .catch(() => {
          setMessages((list) => [
            ...list,
            localMessage('assistant', 'Рэй временно недоступен, все действия доступны в кабинете.', true),
          ])
        })
        .finally(() => setSending(false))
    },
    [buildContext, sending],
  )

  const ask = useCallback(
    (text: string) => {
      setOpen(true)
      send(text)
    },
    [send, setOpen],
  )

  const setScreen = useCallback((next: ScreenContext) => {
    setScreenState((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))
  }, [])

  const reset = useCallback(() => {
    sessionRef.current = null
    writeSession(null)
    setMessages([])
  }, [])

  const suggestions = useMemo(() => {
    const last = [...messages].reverse().find((item) => item.role === 'assistant' && !item.failed)
    if (last && last.suggestions.length) return last.suggestions
    return screen.suggestions?.length ? screen.suggestions : DEFAULT_SUGGESTIONS
  }, [messages, screen.suggestions])

  const value = useMemo<AssistantState>(
    () => ({
      enabled,
      open,
      setOpen,
      messages,
      sending,
      screen,
      suggestions,
      send,
      ask,
      setScreen,
      highlight: highlightElement,
      reset,
    }),
    [enabled, open, setOpen, messages, sending, screen, suggestions, send, ask, setScreen, reset],
  )

  return <AssistantStateContext.Provider value={value}>{children}</AssistantStateContext.Provider>
}

export function useAssistant(): AssistantState {
  const context = useContext(AssistantStateContext)
  if (!context) throw new Error('useAssistant must be used within AssistantProvider')
  return context
}

export function useAssistantScreen(screen: ScreenContext) {
  const { setScreen } = useAssistant()
  const serialized = JSON.stringify(screen)
  useEffect(() => {
    setScreen(JSON.parse(serialized) as ScreenContext)
  }, [serialized, setScreen])
}

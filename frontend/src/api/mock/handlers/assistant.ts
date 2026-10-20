import { http } from 'msw'
import type { AssistantChatRequest, AssistantChatResponse, AssistantContext, AssistantSession } from '@/api/types'
import { assistantReply, userMessage } from '../assistant'
import { apiError, json, uid } from '../utils'
import { readJson, route } from './common'

const MAX_MESSAGES = 120

function parseContext(value: unknown, fallbackPath: string): AssistantContext {
  const source = typeof value === 'object' && value !== null ? (value as Partial<AssistantContext>) : {}
  const data: AssistantContext['data'] = {}
  if (typeof source.data === 'object' && source.data !== null) {
    for (const [key, entry] of Object.entries(source.data)) {
      if (entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') data[key] = entry
    }
  }
  return {
    screen: typeof source.screen === 'string' ? source.screen : 'app',
    title: typeof source.title === 'string' ? source.title : '',
    path: typeof source.path === 'string' ? source.path : fallbackPath,
    application_id: typeof source.application_id === 'string' ? source.application_id : null,
    data,
  }
}

export const assistantHandlers = [
  http.post(
    '/api/assistant/chat',
    route(
      async ({ db, user, request, now }) => {
        const body = await readJson<AssistantChatRequest>(request)
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        if (!message) return apiError(422, 'VALIDATION', 'Введите вопрос')
        const context = parseContext(body.context, '/app')
        let session = db.sessions.find((item) => item.id === body.session_id && item.user_id === user.id)
        if (!session) {
          session = { id: uid(), user_id: user.id, messages: [] }
          db.sessions.push(session)
        }
        const reply = assistantReply(db, user, { session_id: session.id, message: message.slice(0, 2000), context }, now)
        session.messages.push(userMessage(message.slice(0, 2000), now), reply)
        if (session.messages.length > MAX_MESSAGES) session.messages = session.messages.slice(-MAX_MESSAGES)
        const response: AssistantChatResponse = { session_id: session.id, message: reply }
        return json(response)
      },
      { role: 'CLIENT', delay: [800, 1500] },
    ),
  ),
  http.get(
    '/api/assistant/sessions/:id',
    route(
      ({ db, user, params }) => {
        const session = db.sessions.find((item) => item.id === params.id && item.user_id === user.id)
        if (!session) return apiError(404, 'NOT_FOUND', 'Сессия не найдена')
        const response: AssistantSession = { session_id: session.id, messages: session.messages }
        return json(response)
      },
      { role: 'CLIENT' },
    ),
  ),
]

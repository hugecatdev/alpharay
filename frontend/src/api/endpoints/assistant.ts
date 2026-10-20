import { request } from '../client'
import type { AssistantChatRequest, AssistantChatResponse, AssistantSession } from '../types'

export const ASSISTANT_TIMEOUT_MS = 20000

export const assistantApi = {
  chat: (body: AssistantChatRequest) =>
    request<AssistantChatResponse>('/assistant/chat', { method: 'POST', body, timeoutMs: ASSISTANT_TIMEOUT_MS }),
  session: (id: string) => request<AssistantSession>(`/assistant/sessions/${id}`),
}

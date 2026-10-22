import type { ApiErrorBody } from './types'

const TOKEN_KEY = 'alpharay-token'
const API_PREFIX = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly missing: string[]

  constructor(status: number, body: ApiErrorBody) {
    super(body.detail)
    this.status = status
    this.code = body.code
    this.missing = body.missing ?? []
  }
}

let token: string | null = readStoredToken()
const unauthorizedListeners = new Set<() => void>()

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getToken(): string | null {
  return token
}

export function setToken(value: string | null): void {
  token = value
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    return
  }
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  form?: FormData
  query?: Record<string, QueryValue>
  signal?: AbortSignal
  timeoutMs?: number
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
    }
  }
  const search = params.toString()
  return `${API_PREFIX}${path}${search ? `?${search}` : ''}`
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'detail' in value
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let body: BodyInit | undefined
  if (options.form) {
    body = options.form
  } else if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }

  const controller = new AbortController()
  const timer = options.timeoutMs ? window.setTimeout(() => controller.abort(), options.timeoutMs) : undefined
  options.signal?.addEventListener('abort', () => controller.abort())

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new ApiError(0, { detail: 'Превышено время ожидания ответа', code: 'TIMEOUT' })
    }
    throw new ApiError(0, { detail: error instanceof Error ? error.message : 'Сеть недоступна', code: 'NETWORK' })
  } finally {
    if (timer) window.clearTimeout(timer)
  }

  if (response.status === 401) {
    setToken(null)
    unauthorizedListeners.forEach((listener) => listener())
  }

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get('Content-Type') ?? ''
  const payload: unknown = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    if (isErrorBody(payload)) throw new ApiError(response.status, payload)
    throw new ApiError(response.status, { detail: `Ошибка ${response.status}`, code: 'HTTP_ERROR' })
  }

  return payload as T
}

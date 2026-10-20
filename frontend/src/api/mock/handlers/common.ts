import type { PathParams } from 'msw'
import type { Role } from '@/api/types'
import { findApplication, loadDb, saveDb, type MockApplication, type MockDb, type MockUser } from '../db'
import { advanceAll } from '../pipeline'
import { apiError, networkDelay, param } from '../utils'

export interface HandlerContext {
  db: MockDb
  user: MockUser
  request: Request
  params: Record<string, string>
  url: URL
  now: number
}

export interface PublicContext {
  db: MockDb
  user: MockUser | null
  request: Request
  params: Record<string, string>
  url: URL
  now: number
}

type Resolver = (info: { request: Request; params: PathParams }) => Promise<Response>

interface Options {
  role?: Role
  delay?: [number, number]
}

function resolveUser(db: MockDb, request: Request): MockUser | null {
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer\s+mock-token-(.+)$/.exec(header)
  if (!match) return null
  return db.users.find((user) => user.id === match[1]) ?? null
}

function normalizeParams(params: PathParams): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) result[key] = param(value)
  return result
}

async function run(db: MockDb, fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    const response = await fn()
    saveDb(db)
    return response
  } catch (error) {
    saveDb(db)
    return apiError(500, 'MOCK_ERROR', error instanceof Error ? error.message : 'Внутренняя ошибка мок-сервера')
  }
}

export function publicRoute(fn: (ctx: PublicContext) => Response | Promise<Response>, options: Options = {}): Resolver {
  return async ({ request, params }) => {
    const [min, max] = options.delay ?? [150, 400]
    await networkDelay(min, max)
    const db = loadDb()
    const now = Date.now()
    advanceAll(db, now)
    const user = resolveUser(db, request)
    return run(db, () => fn({ db, user, request, params: normalizeParams(params), url: new URL(request.url), now }))
  }
}

export function route(fn: (ctx: HandlerContext) => Response | Promise<Response>, options: Options = {}): Resolver {
  return async ({ request, params }) => {
    const [min, max] = options.delay ?? [150, 400]
    await networkDelay(min, max)
    const db = loadDb()
    const now = Date.now()
    advanceAll(db, now)
    const user = resolveUser(db, request)
    if (!user) {
      saveDb(db)
      return apiError(401, 'UNAUTHORIZED', 'Требуется вход в систему')
    }
    if (options.role && user.role !== options.role) {
      saveDb(db)
      return apiError(403, 'FORBIDDEN', 'Недостаточно прав для этого действия')
    }
    return run(db, () => fn({ db, user, request, params: normalizeParams(params), url: new URL(request.url), now }))
  }
}

export function ownApplication(ctx: HandlerContext, id: string): MockApplication | null {
  const record = findApplication(ctx.db, id)
  if (!record || !ctx.user.company_id || record.company_id !== ctx.user.company_id) return null
  return record
}

export function notFound(): Response {
  return apiError(404, 'NOT_FOUND', 'Заявка не найдена')
}

export async function readJson<T>(request: Request): Promise<Partial<T>> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null ? (body as Partial<T>) : {}
  } catch {
    return {}
  }
}

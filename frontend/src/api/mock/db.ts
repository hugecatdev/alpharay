import type {
  ActiveLoan,
  AppEvent,
  AppNotification,
  Application,
  AssistantMessage,
  BkiData,
  Company,
  EgrulData,
  FnsData,
  InfoAnswer,
  Product,
  Recommendation,
  Scoring,
  TurnoverMonth,
  User,
} from '@/api/types'
import { createSeed, DB_VERSION } from './seeds'

export const DB_KEY = 'alfa-mock-db'

export type ClientKey = 'client1' | 'client2' | 'client3' | 'client4' | 'client5' | 'newcomer' | 'background'

export interface MockUser extends User {
  password: string
}

export interface MockCompany {
  key: ClientKey
  company: Company
  egrul: EgrulData
  fns: FnsData
  bki: BkiData
  turnover: TurnoverMonth[]
  external_loans: ActiveLoan[]
}

export interface MockApplication {
  app: Application
  company_id: string
  user_id: string | null
  scoring: Scoring | null
  recommendation: Recommendation | null
  enriched: boolean
  assigned_to: string | null
  stage_entered_at: number
  mock_fail: boolean
  mock_fail_event_done: boolean
  info_round: number
  info_answers: InfoAnswer[]
  disburse_at: number | null
  disbursed_at: string | null
}

export interface MockEvent extends AppEvent {
  application_id: string
}

export interface MockNotification extends AppNotification {
  user_id: string
}

export interface MockSession {
  id: string
  user_id: string
  messages: AssistantMessage[]
}

export interface MockDb {
  version: number
  seeded_at: number
  counter: number
  users: MockUser[]
  companies: MockCompany[]
  products: Product[]
  applications: MockApplication[]
  events: MockEvent[]
  notifications: MockNotification[]
  sessions: MockSession[]
}

let memory: MockDb | null = null

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isDb(value: unknown): value is MockDb {
  return typeof value === 'object' && value !== null && (value as { version?: unknown }).version === DB_VERSION
}

let listening = false

function listenForOtherTabs(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('storage', (event) => {
    if (event.key === DB_KEY) memory = null
  })
}

export function loadDb(): MockDb {
  listenForOtherTabs()
  if (memory) return memory
  const store = storage()
  if (store) {
    try {
      const raw = store.getItem(DB_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (isDb(parsed)) {
          memory = parsed
          return parsed
        }
      }
    } catch {
      memory = null
    }
  }
  const seeded = createSeed(Date.now())
  saveDb(seeded)
  return seeded
}

export function saveDb(db: MockDb): void {
  memory = db
  const store = storage()
  if (!store) return
  try {
    store.setItem(DB_KEY, JSON.stringify(db))
  } catch {
    return
  }
}

export function resetDb(): MockDb {
  memory = null
  const store = storage()
  try {
    store?.removeItem(DB_KEY)
  } catch {
    memory = null
  }
  const seeded = createSeed(Date.now())
  saveDb(seeded)
  return seeded
}

export function nextNumber(db: MockDb): string {
  db.counter += 1
  return `КР-2026-${String(db.counter).padStart(6, '0')}`
}

export function findCompany(db: MockDb, companyId: string | null | undefined): MockCompany | undefined {
  return db.companies.find((item) => item.company.id === companyId)
}

export function findApplication(db: MockDb, id: string): MockApplication | undefined {
  return db.applications.find((item) => item.app.id === id)
}

export function findProduct(db: MockDb, code: string): Product | undefined {
  return db.products.find((product) => product.code === code)
}

export function companyUser(db: MockDb, companyId: string): MockUser | undefined {
  return db.users.find((user) => user.company_id === companyId)
}

export function publicUser(user: MockUser): User {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    position: user.position,
    company_id: user.company_id,
  }
}

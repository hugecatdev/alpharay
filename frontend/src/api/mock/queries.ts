import type { AppEvent, ApplicationShort, BankApplication, BankApplicationShort } from '@/api/types'
import { findCompany, type MockApplication, type MockDb } from './db'
import { computeDiscrepancies } from './scoring'

export function findApplicationsOfCompany(db: MockDb, companyId: string): MockApplication[] {
  return db.applications.filter((record) => record.company_id === companyId)
}

export function toShort(record: MockApplication): ApplicationShort {
  const app = record.app
  return {
    id: app.id,
    number: app.number,
    product_code: app.product.code,
    product_name: app.product.name,
    amount: app.amount,
    term: app.term,
    status: app.status,
    created_at: app.created_at,
    updated_at: app.updated_at,
  }
}

export function toBankShort(record: MockApplication): BankApplicationShort {
  const app = record.app
  return {
    id: app.id,
    number: app.number,
    company_name: app.company.name,
    inn: app.company.inn,
    product_code: app.product.code,
    product_name: app.product.name,
    amount: app.amount,
    term: app.term,
    status: app.status,
    grade: record.scoring?.grade ?? null,
    score: record.scoring?.score ?? null,
    waiting_since: new Date(record.stage_entered_at).toISOString(),
    assigned_to: record.assigned_to,
  }
}

export function toBankApplication(db: MockDb, record: MockApplication): BankApplication {
  const mc = findCompany(db, record.company_id)
  return {
    ...record.app,
    enrichment: mc && record.enriched ? { egrul: mc.egrul, fns: mc.fns, bki: mc.bki } : null,
    scoring: record.scoring,
    recommendation: record.recommendation,
    discrepancies: mc ? computeDiscrepancies(mc, record.app) : [],
    assigned_to: record.assigned_to,
  }
}

export function eventsOf(db: MockDb, applicationId: string): AppEvent[] {
  return db.events
    .filter((event) => event.application_id === applicationId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((event) => ({
      id: event.id,
      from_status: event.from_status,
      to_status: event.to_status,
      actor_type: event.actor_type,
      actor_name: event.actor_name,
      reason: event.reason,
      created_at: event.created_at,
    }))
}

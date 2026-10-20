import { delay, HttpResponse } from 'msw'
import type { ApiErrorBody } from '@/api/types'

export const DAY = 24 * 60 * 60 * 1000
export const HOUR = 60 * 60 * 1000
export const MINUTE = 60 * 1000

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

export function between(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min))
}

export async function networkDelay(min = 150, max = 400): Promise<void> {
  await delay(between(min, max))
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function addMonths(ms: number, months: number): number {
  const date = new Date(ms)
  date.setMonth(date.getMonth() + months)
  return date.getTime()
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function json<T>(body: T, status = 200): Response {
  return new HttpResponse(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function noContent(): Response {
  return new HttpResponse(null, { status: 204 })
}

export function apiError(status: number, code: string, detail: string, missing?: string[]): Response {
  const body: ApiErrorBody = missing ? { detail, code, missing } : { detail, code }
  return json(body, status)
}

export function param(value: string | readonly string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return typeof value === 'string' ? value : ''
}

export function money(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value)).replace(/[\u00a0\u202f]/g, ' ')} ₽`
}

export function moneyShort(value: number): string {
  const abs = Math.abs(value)
  const fmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
  if (abs >= 1_000_000) return `${fmt.format(value / 1_000_000)} млн ₽`
  if (abs >= 10_000) return `${Math.round(value / 1000)} тыс ₽`
  return money(value)
}

export function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value
}

export function rateText(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)}%`
}

export function percent(value: number, digits = 0): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)}%`
}

export function dateRu(value: string | number): string {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function monthsBetween(fromIso: string, to: number): number {
  const start = new Date(fromIso)
  const end = new Date(to)
  return Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth())
}

export function ageLabel(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  const parts: string[] = []
  if (years) {
    const mod10 = years % 10
    const mod100 = years % 100
    const word = mod10 === 1 && mod100 !== 11 ? 'год' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'года' : 'лет'
    parts.push(`${years} ${word}`)
  }
  if (months || !years) parts.push(`${months} мес.`)
  return parts.join(' ')
}

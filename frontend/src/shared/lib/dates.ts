const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const monthShort = new Intl.DateTimeFormat('ru-RU', { month: 'short' })
const monthLong = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value)
}

export function formatDate(value: string | Date): string {
  return dateFormat.format(toDate(value))
}

export function formatTime(value: string | Date): string {
  return timeFormat.format(toDate(value))
}

export function formatDateTime(value: string | Date): string {
  return `${formatDate(value)}, ${formatTime(value)}`
}

export function formatMonthShort(month: string): string {
  return monthShort.format(new Date(`${month}-01T00:00:00`)).replace('.', '')
}

export function formatMonthLong(month: string): string {
  return monthLong.format(new Date(`${month}-01T00:00:00`))
}

export function formatRelative(value: string | Date, now: Date = new Date()): string {
  const date = toDate(value)
  const diff = Math.round((now.getTime() - date.getTime()) / 1000)
  if (diff < 45) return 'только что'
  if (diff < 3600) return `${Math.round(diff / 60)} мин назад`
  if (diff < 86400 && now.getDate() === date.getDate()) return `сегодня в ${formatTime(date)}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (yesterday.toDateString() === date.toDateString()) return `вчера в ${formatTime(date)}`
  return formatDate(date)
}

export function formatUpdated(value: string | Date, now: Date = new Date()): string {
  return `обновлена ${formatRelative(value, now)}`
}

export function businessAge(registrationDate: string, now: Date = new Date()): { years: number; months: number; totalMonths: number } {
  const start = new Date(registrationDate)
  const totalMonths = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth())
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, totalMonths }
}

export function formatBusinessAge(registrationDate: string): string {
  const { years, months } = businessAge(registrationDate)
  const parts: string[] = []
  if (years) parts.push(`${years} ${plural(years, 'год', 'года', 'лет')}`)
  if (months || !years) parts.push(`${months} мес.`)
  return parts.join(' ')
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function formatTerm(months: number): string {
  return `${months} мес.`
}

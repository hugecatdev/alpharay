const integer = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const rateFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })

export function formatNumber(value: number): string {
  return integer.format(Math.round(value)).replace(/[\u202f\u00a0]/g, '\u00a0')
}

export function formatMoney(value: number): string {
  return `${formatNumber(value)}\u00a0₽`
}

export function formatMoneyShort(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${oneDecimal.format(value / 1_000_000_000)} млрд ₽`
  if (abs >= 1_000_000) return `${oneDecimal.format(value / 1_000_000)} млн ₽`
  if (abs >= 10_000) return `${integer.format(Math.round(value / 1000))} тыс ₽`
  return formatMoney(value)
}

export function formatRate(value: number): string {
  return `${rateFormat.format(value)}%`
}

export function formatPercent(value: number, digits = 0): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)}%`
}

export function parseMoneyInput(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${oneDecimal.format(bytes / 1024 / 1024)} МБ`
  if (bytes >= 1024) return `${integer.format(bytes / 1024)} КБ`
  return `${bytes} Б`
}

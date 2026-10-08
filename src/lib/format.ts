import { getLocale } from '@/paraglide/runtime'

const NBSP = ' '
const MISSING = '—'

export function formatDuration(seconds: number, locale: string = getLocale()): string {
  if (!Number.isFinite(seconds) || seconds < 0) return MISSING
  const total = Math.floor(seconds)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const part = (value: number, unit: string) => `${value}${NBSP}${unit}`
  if (d > 0) return `${part(d, locale === 'fr' ? 'j' : 'd')} ${part(h, 'h')}`
  if (h > 0) return `${part(h, 'h')} ${part(m, 'min')}`
  if (m > 0) return `${part(m, 'min')} ${part(s, 's')}`
  return part(s, 's')
}

export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return MISSING
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()

function clockFormat(locale: string) {
  let format = dateFormats.get(locale)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    dateFormats.set(locale, format)
  }
  return format
}

export function formatClock(iso: string, locale: string = getLocale()): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? MISSING : clockFormat(locale).format(date)
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type DayOptions = { weekday?: boolean; locale?: string; now?: Date }

export function formatDay(
  iso: string,
  { weekday = false, locale = getLocale(), now = new Date() }: DayOptions = {}
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return MISSING
  return new Intl.DateTimeFormat(locale, {
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

export function formatDayTime(
  iso: string,
  { locale = getLocale(), now }: Omit<DayOptions, 'weekday'> = {}
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return MISSING
  return `${formatDay(iso, { weekday: true, locale, now })}${NBSP}· ${formatClock(iso, locale)}`
}

export function computeDurationSecs(startedAt: string, endedAt: string | null): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  return Math.floor((end - start) / 1000)
}

const numberFormats = new Map<string, Intl.NumberFormat>()

export function formatNumber(
  value: number | null | undefined,
  digits = 0,
  locale: string = getLocale()
): string {
  if (value == null || !Number.isFinite(value)) return MISSING
  const key = `${locale}:${digits}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    numberFormats.set(key, format)
  }
  return format.format(value)
}

export function formatMs(
  ms: number | null | undefined,
  {
    digits = 1,
    atLeast = false,
    locale = getLocale(),
  }: { digits?: number; atLeast?: boolean; locale?: string } = {}
): string {
  if (ms == null || !Number.isFinite(ms)) return MISSING
  const prefix = atLeast ? `≥${NBSP}` : ''
  return `${prefix}${formatNumber(ms, digits, locale)}${NBSP}ms`
}

const BYTE_UNITS = [
  ['gigabyte', 1e9],
  ['megabyte', 1e6],
  ['kilobyte', 1e3],
] as const

export function formatBytes(
  bytes: number | null | undefined,
  locale: string = getLocale()
): string {
  if (bytes == null || !Number.isFinite(bytes)) return MISSING
  const [unit, size] = BYTE_UNITS.find(([, size]) => bytes >= size) ?? BYTE_UNITS[2]
  const value = bytes / size
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)
}

export function formatPercent(
  value: number | null | undefined,
  { digits = 0, locale = getLocale() }: { digits?: number; locale?: string } = {}
): string {
  if (value == null || !Number.isFinite(value)) return MISSING
  const space = locale === 'en' ? '' : NBSP
  return `${formatNumber(value, digits, locale)}${space}%`
}

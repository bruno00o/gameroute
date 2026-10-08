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

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function computeDurationSecs(startedAt: string, endedAt: string | null): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  return Math.floor((end - start) / 1000)
}

export function latencyColor(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 30) return 'text-ok'
  if (ms < 80) return 'text-watch'
  return 'text-destructive'
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

export function formatPercent(
  value: number | null | undefined,
  { digits = 0, locale = getLocale() }: { digits?: number; locale?: string } = {}
): string {
  if (value == null || !Number.isFinite(value)) return MISSING
  const space = locale === 'en' ? '' : NBSP
  return `${formatNumber(value, digits, locale)}${space}%`
}

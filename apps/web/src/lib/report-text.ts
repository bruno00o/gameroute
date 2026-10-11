import {
  type MatchReason,
  REPORT_GAMES,
  type ReportMatch,
  type ReportPayload,
  type ReportSeverity,
  type RouteZone,
} from '@gameroute/shared'
import { m } from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'

const NBSP = ' '

type Message = () => string

export const ZONE_LABELS: Record<RouteZone, Message> = {
  home: m.report_zone_home,
  isp: m.report_zone_isp,
  transit: m.report_zone_transit,
  service: m.report_zone_service,
}

export const STATUS_LABELS: Record<ReportSeverity, Message> = {
  ok: m.report_status_ok,
  watch: m.report_status_watch,
  degraded: m.report_status_degraded,
  critical: m.report_status_critical,
  unmeasured: m.report_status_unmeasured,
}

export const REASON_LABELS: Record<MatchReason, Message> = {
  loss: m.report_reason_loss,
  ping_over_usual: m.report_reason_ping_over_usual,
  ping_high: m.report_reason_ping_high,
}

const VERDICT_PLAYER: Record<RouteZone, Message> = {
  home: m.report_verdict_home,
  isp: m.report_verdict_isp,
  transit: m.report_verdict_transit,
  service: m.report_verdict_service,
}

const VERDICT_THIRD: Record<RouteZone, Message> = {
  home: m.report_verdict_third_home,
  isp: m.report_verdict_third_isp,
  transit: m.report_verdict_third_transit,
  service: m.report_verdict_third_service,
}

const VERDICT_SHORT: Record<RouteZone, Message> = {
  home: m.report_short_home,
  isp: m.report_short_isp,
  transit: m.report_short_transit,
  service: m.report_short_service,
}

export function gameName(payload: ReportPayload): string {
  return REPORT_GAMES[payload.gameSlug]
}

export function matchesLabel(count: number): string {
  return count === 1 ? m.report_matches_one({ count }) : m.report_matches_other({ count })
}

export function verdictHeadline(payload: ReportPayload): string {
  const { status, zone } = payload.verdict
  const count = payload.matches.length
  if (status === 'ok') return m.report_verdict_ok({ matches: matchesLabel(count) })
  if (status === 'unmeasured') {
    return count === 1 ? m.report_verdict_unmeasured_one() : m.report_verdict_unmeasured_other()
  }
  if (!zone) return m.report_verdict_unlocated()
  return (payload.recipient === 'forum' ? VERDICT_PLAYER : VERDICT_THIRD)[zone]()
}

export function verdictShort(payload: ReportPayload): string {
  const { status, zone } = payload.verdict
  if (status === 'ok') return m.report_short_ok()
  if (status === 'unmeasured') return m.report_short_unmeasured()
  return zone ? VERDICT_SHORT[zone]() : m.report_short_unlocated()
}

export function formatMs(value: number, atLeast = false): string {
  const digits = Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0
  const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(value)
  return `${atLeast ? `≥${NBSP}` : ''}${number}${NBSP}ms`
}

export function formatAddedMs(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatMs(value)}`
}

export function formatPct(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 1
  const number = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(value)
  return `${number}${NBSP}%`
}

export function sourceLabel(match: ReportMatch): string {
  if (match.source === 'game') return m.report_source_game()
  if (match.pingAtLeast && match.measuredUpToHop != null) {
    return m.report_source_probe_up_to({ hop: match.measuredUpToHop })
  }
  return m.report_source_probe()
}

export function worstMatchSummary(payload: ReportPayload): string | null {
  const match = payload.matches.find(
    candidate => candidate.status === payload.verdict.status && candidate.reason
  )
  if (!match?.reason) return null
  const number = match.number
  if (match.reason === 'loss') {
    return match.lossPct == null
      ? null
      : m.report_worst_loss({ number, loss: formatPct(match.lossPct) })
  }
  if (match.pingMedianMs == null) return null
  const ping = `${formatMs(match.pingMedianMs, match.pingAtLeast)} (${sourceLabel(match)})`
  if (match.reason === 'ping_over_usual' && match.usualPingMs != null) {
    return m.report_worst_ping_over_usual({ number, ping, usual: formatMs(match.usualPingMs) })
  }
  return m.report_worst_ping_high({ number, ping })
}

interface WallClock {
  date: Date
  offsetMinutes: number
}

const OFFSET = /([+-])(\d{2}):(\d{2})$/

export function wallClock(iso: string): WallClock {
  const match = OFFSET.exec(iso)
  const offsetMinutes = match
    ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0
  return { date: new Date(Date.parse(iso) + offsetMinutes * 60_000), offsetMinutes }
}

export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC'
  const sign = minutes < 0 ? '-' : '+'
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`
}

const format = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(getLocale(), { timeZone: 'UTC', ...options })

export function formatDay(date: Date): string {
  return format({ day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

export function formatHour(date: Date, exact: boolean): string {
  return format(exact ? { hour: '2-digit', minute: '2-digit' } : { hour: 'numeric' }).format(date)
}

export function formatMatchStart(iso: string, exact: boolean): string {
  const { date } = wallClock(iso)
  return `${format({ day: 'numeric', month: 'short' }).format(date)}, ${formatHour(date, exact)}`
}

export function reportPeriod(payload: ReportPayload): string {
  const starts = payload.matches
    .map(match => wallClock(match.startedAt))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const first = starts[0]
  const last = starts[starts.length - 1]
  const exact = payload.exactTimes
  const firstDay = formatDay(first.date)
  const lastDay = formatDay(last.date)
  const firstHour = formatHour(first.date, exact)
  const lastHour = formatHour(last.date, exact)
  const text =
    firstDay !== lastDay
      ? m.report_period_days({ start: `${firstDay}, ${firstHour}`, end: `${lastDay}, ${lastHour}` })
      : firstHour === lastHour
        ? m.report_period_same_hour({ day: firstDay, hour: firstHour })
        : m.report_period_range({ day: firstDay, start: firstHour, end: lastHour })
  return `${text} (${m.report_period_zone({ zone: formatOffset(first.offsetMinutes) })})`
}

export function reportDay(payload: ReportPayload): string {
  const first = payload.matches
    .map(match => wallClock(match.startedAt).date)
    .sort((a, b) => a.getTime() - b.getTime())[0]
  return formatDay(first)
}

export function formatDate(iso: string): string {
  return formatDay(new Date(iso))
}

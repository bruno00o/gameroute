import * as m from '@/paraglide/messages'
import type {
  GamePingSample,
  LivePoint,
  LiveProbeSample,
  LiveReading,
  LiveStatus,
  LiveTrack,
  SessionDetail,
  SessionMatch,
  TracerouteWithHops,
} from '@/types/backend'
import { formatDuration, formatElapsed, formatMs, formatNumber } from '@/lib/format'
import { shortOperatorName } from '@/lib/operators'
import { zoneLabel } from '@/lib/route'

export const SERIES_WINDOW_MS = 60_000
export const BAND_WINDOW_MS = 5_000

export type SeriesPoint = { at: number; v: number | null }

export type LiveSeries = { floor: SeriesPoint[]; game: SeriesPoint[] }

export type LiveScreen = 'idle' | 'waiting' | 'measuring' | 'live' | 'frozen'

const NBSP = ' '

export const emptySeries = (): LiveSeries => ({ floor: [], game: [] })

export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null
  const time = Date.parse(iso)
  return Number.isNaN(time) ? null : time
}

export function countsAsBeat(source: string, primary: LivePoint | null): boolean {
  if (primary === 'game') return source === 'game'
  if (primary === 'floor') return source === 'floor'
  return true
}

export function probePoint(sample: LiveProbeSample): SeriesPoint | null {
  const at = parseTime(sample.measuredAt)
  return at == null ? null : { at, v: sample.rttMs }
}

export function gamePoint(sample: GamePingSample): SeriesPoint | null {
  const at = parseTime(sample.measuredAt)
  if (at == null || sample.rttMs == null) return null
  return { at, v: sample.rttMs }
}

export function trackSeries(track: LiveTrack | null): SeriesPoint[] {
  if (!track) return []
  return track.samples.flatMap(sample => {
    const point = probePoint(sample)
    return point ? [point] : []
  })
}

export function trimSeries(points: SeriesPoint[]): SeriesPoint[] {
  const newest = points.at(-1)?.at
  if (newest == null) return points
  const from = newest - SERIES_WINDOW_MS
  const first = points.findIndex(point => point.at > from)
  return first <= 0 ? points : points.slice(first)
}

export function mergeSeries(current: SeriesPoint[], seeded: SeriesPoint[]): SeriesPoint[] {
  if (seeded.length === 0) return current
  const known = new Set(current.map(point => point.at))
  const merged = [...current, ...seeded.filter(point => !known.has(point.at))]
  merged.sort((a, b) => a.at - b.at)
  return trimSeries(merged)
}

export function readingSeries(series: LiveSeries, primary: LivePoint | null): SeriesPoint[] {
  if (primary === 'game') return series.game
  if (primary === 'floor') return series.floor
  return series.floor.length >= series.game.length ? series.floor : series.game
}

export function seriesLast(points: SeriesPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const value = points[i].v
    if (value != null) return value
  }
  return null
}

export function seriesWorst(points: SeriesPoint[]): number | null {
  const values = points.flatMap(point => (point.v == null ? [] : [point.v]))
  return values.length ? Math.max(...values) : null
}

export function seriesEnd(status: LiveStatus | null, points: SeriesPoint[]): number {
  const last = points.at(-1)?.at ?? Date.now()
  if (!status) return last
  if (status.state === 'frozen') return parseTime(status.lastSampleAt) ?? last
  return parseTime(status.updatedAt) ?? last
}

const CEILINGS = [10, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000]

export function niceCeil(value: number): number {
  return CEILINGS.find(ceiling => ceiling >= value) ?? Math.ceil(value / 500) * 500
}

export function liveScreen(
  status: LiveStatus | null,
  monitoring: { isMonitoring: boolean; hasGame: boolean }
): LiveScreen {
  if (!status) return monitoring.isMonitoring && monitoring.hasGame ? 'waiting' : 'idle'
  return status.state
}

export function matchElapsed(status: LiveStatus): number | null {
  const start = parseTime(status.matchStartedAt)
  const now = parseTime(status.updatedAt)
  if (start == null || now == null) return null
  return Math.max(0, (now - start) / 1000)
}

export function matchClock(status: LiveStatus): string | null {
  const elapsed = matchElapsed(status)
  return elapsed == null ? null : formatElapsed(elapsed)
}

export function sinceMatchStart(status: LiveStatus, iso: string | null): string | null {
  const start = parseTime(status.matchStartedAt)
  const at = parseTime(iso)
  if (start == null || at == null) return null
  return formatElapsed(Math.max(0, (at - start) / 1000))
}

export function frozenAge(status: LiveStatus): number | null {
  const now = parseTime(status.updatedAt)
  const since = parseTime(status.lastSampleAt) ?? parseTime(status.stateSince)
  if (now == null || since == null) return null
  return Math.max(0, Math.round((now - since) / 1000))
}

export function ageText(seconds: number | null): string | null {
  return seconds == null ? null : formatDuration(seconds)
}

export function readingHop(reading: LiveReading): number | null {
  return reading.hop ?? reading.basis.measuredHop
}

export function readingOperator(reading: LiveReading): string | null {
  return shortOperatorName(reading.operator)
}

export function readingBasis(reading: LiveReading): string {
  if (reading.point === 'game') return m.ping_by_game()
  if (!reading.atLeast) return m.live_basis_server()
  const hop = readingHop(reading)
  if (hop == null) return m.live_basis_up_to_router()
  const operator = readingOperator(reading) ?? (reading.zone ? zoneLabel(reading.zone) : null)
  return operator
    ? m.measured_up_to({ hop: String(hop), operator })
    : m.measured_up_to_hop({ hop: String(hop) })
}

export function readingValue(reading: LiveReading | null): string {
  if (reading?.medianMs == null) return '—'
  return `${reading.atLeast ? `≥${NBSP}` : ''}${formatNumber(reading.medianMs, 0)}`
}

export function readingPing(reading: LiveReading | null): string {
  if (reading?.medianMs == null) return '—'
  return formatMs(reading.medianMs, { digits: 0, atLeast: reading.atLeast })
}

export function readingReference(reading: LiveReading): {
  kind: 'usual' | 'trace'
  ms: number
  delta: number | null
} | null {
  const usual = reading.usual.medianMs
  const ms = usual ?? reading.traceMs
  if (ms == null) return null
  const delta = reading.medianMs == null ? null : reading.medianMs - ms
  return { kind: usual != null ? 'usual' : 'trace', ms, delta }
}

export function referenceText(reading: LiveReading): string | null {
  const reference = readingReference(reading)
  if (!reference) return null
  const base = formatMs(reference.ms, { digits: 0, atLeast: reading.atLeast })
  const delta =
    reference.delta != null && Math.abs(reference.delta) >= 1
      ? ` (${reference.delta > 0 ? '+' : '−'}${formatNumber(Math.abs(reference.delta), 0)})`
      : ''
  return reference.kind === 'usual'
    ? m.live_usual({ ping: `${base}${delta}` })
    : m.live_trace_reference({ ping: `${base}${delta}` })
}

export function currentMatch(
  matches: SessionMatch[] | undefined,
  status: LiveStatus
): SessionMatch | undefined {
  const sameServer = (matches ?? []).filter(match => match.ip === status.serverIp)
  return sameServer.find(match => match.startedAt === status.matchStartedAt) ?? sameServer.at(-1)
}

export function currentTrace(
  detail: SessionDetail | null | undefined,
  status: LiveStatus
): TracerouteWithHops | undefined {
  return (detail?.traceroutes ?? [])
    .filter(trace => trace.targetIp === status.serverIp && trace.route != null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
}

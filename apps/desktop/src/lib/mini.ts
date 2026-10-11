import * as m from '@/paraglide/messages'
import type { LiveState as BadgeState } from '@/lib/live-state'
import { formatElapsed, formatMs, formatNumber, formatPercent } from '@/lib/format'
import type {
  FaultZone,
  LivePoint,
  LiveReading,
  LiveState,
  LiveStatus,
  PingSource,
} from '@/types/backend'

export const MINI_WINDOW_MS = 60_000

export type MiniSample = { at: number; rttMs: number | null }

export type SampleSource = { source: PingSource; measuredAt: string; rttMs: number | null }

const sourceOfPoint: Record<LivePoint, PingSource> = {
  gateway: 'gateway',
  isp_edge: 'isp_edge',
  floor: 'floor',
  game: 'game',
}

export function sourceOf(point: LivePoint): PingSource {
  return sourceOfPoint[point]
}

export function toSample(sample: SampleSource): MiniSample {
  return { at: Date.parse(sample.measuredAt), rttMs: sample.rttMs }
}

export function appendSample(samples: MiniSample[], next: MiniSample): MiniSample[] {
  if (Number.isNaN(next.at)) return samples
  const from = next.at - MINI_WINDOW_MS
  return [...samples.filter(sample => sample.at >= from && sample.at < next.at), next]
}

const badgeStates: Record<LiveState, BadgeState> = {
  live: 'live',
  measuring: 'measuring',
  waiting: 'measuring',
  frozen: 'stale',
}

export function badgeState(status: LiveStatus | null): BadgeState {
  return status ? badgeStates[status.state] : 'idle'
}

export function secondsSince(from: string | null, now: number): number | null {
  if (!from) return null
  const seconds = Math.floor((now - Date.parse(from)) / 1000)
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null
}

export function matchElapsed(status: LiveStatus, now: number): string | null {
  const seconds = secondsSince(status.matchStartedAt, now)
  return seconds == null ? null : formatElapsed(seconds)
}

export function liveTitle(status: LiveStatus | null): string {
  if (!status) return 'GameRoute'
  const region = status.region?.region
  return region ? `${status.gameName}, ${region}` : status.gameName
}

export function readingValue(reading: LiveReading | null | undefined): string | null {
  if (reading?.medianMs == null) return null
  const value = formatNumber(Math.round(reading.medianMs))
  return reading.atLeast ? `≥\u00a0${value}` : value
}

export function readingFacts(reading: LiveReading): string[] {
  const facts: string[] = []
  if (reading.jitterMs != null) facts.push(m.mini_jitter({ value: formatMs(reading.jitterMs) }))
  if (reading.lossPct != null) {
    facts.push(m.mini_loss({ value: formatPercent(reading.lossPct, { digits: 1 }) }))
  }
  if (reading.basis.source === 'game') facts.push(m.ping_by_game())
  else if (reading.atLeast && reading.hop != null) {
    facts.push(m.measured_up_to_hop({ hop: reading.hop }))
  }
  return facts
}

const faultWhere: Record<FaultZone, () => string> = {
  home: m.mini_fault_home,
  isp: m.mini_fault_isp,
  transit: m.mini_fault_transit,
  service: m.mini_fault_service,
  after_isp: m.mini_fault_after_isp,
  not_home: m.mini_fault_not_home,
  unlocated: m.mini_fault_unlocated,
}

function where(zone: FaultZone, operator: string | null): string {
  if (!operator || zone === 'home' || zone === 'not_home' || zone === 'unlocated') {
    return faultWhere[zone]()
  }
  return zone === 'isp'
    ? m.mini_fault_operator({ operator })
    : m.mini_fault_operator_not_home({ operator })
}

export function faultText(status: LiveStatus): string | null {
  const fault = status.fault
  if (!fault || status.status === 'ok' || status.status === 'unmeasured') return null
  const reading = status.points.find(point => point.point === fault.atPoint) ?? status.primary
  let cause: string
  if (fault.cause === 'loss') {
    cause =
      reading?.lossPct != null
        ? m.mini_cause_loss({ value: formatPercent(reading.lossPct) })
        : m.mini_cause_loss_plain()
  } else if (fault.cause === 'jitter') {
    cause =
      reading?.jitterMs != null
        ? m.mini_cause_jitter({ value: formatMs(reading.jitterMs, { digits: 0 }) })
        : m.mini_cause_jitter_plain()
  } else {
    cause = m.mini_cause_latency()
  }
  return `${cause} ${where(fault.zone, fault.operator)}`
}

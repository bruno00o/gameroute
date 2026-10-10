import * as m from '@/paraglide/messages'
import type {
  FaultZone,
  IncidentCause,
  LiveReading,
  LiveStatus,
  RouteZone,
  Severity,
  ZoneEvidence,
} from '@/types/backend'
import { formatMs } from '@/lib/format'
import { readingHop, readingOperator, readingPing, sinceMatchStart } from '@/lib/live'
import { formatLoss, severityLabel, type VerdictZone } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { zoneLabel } from '@/lib/route'

const ZONES: RouteZone[] = ['home', 'isp', 'transit', 'service']

export type MetricInput = {
  cause: IncidentCause | null
  atLeast: boolean
  pingMs: number | null
  usualMs: number | null
  lossPct: number | null
  jitterMs: number | null
}

export type LiveVerdict = {
  status: Severity
  title: string
  body: string
  advice: string[]
  zone: RouteZone | null
  zones: Record<RouteZone, VerdictZone>
}

export function metricText(input: MetricInput): string | null {
  const { cause, atLeast, pingMs, usualMs, lossPct, jitterMs } = input
  if (cause === 'loss' && lossPct != null) return m.live_metric_loss({ loss: formatLoss(lossPct) })
  if (cause === 'jitter' && jitterMs != null) {
    return m.live_metric_jitter({ jitter: formatMs(jitterMs, { digits: 1 }) })
  }
  if (cause === 'latency' && pingMs != null) {
    const ping = formatMs(pingMs, { digits: 0, atLeast })
    return usualMs != null
      ? m.live_metric_ping_usual({ ping, usual: formatMs(usualMs, { digits: 0, atLeast }) })
      : m.live_metric_ping({ ping })
  }
  return null
}

export function whereText(zone: FaultZone | null, operator: string | null): string | null {
  const name = shortOperatorName(operator)
  if (zone === 'home') return m.verdict_where_home()
  if (zone === 'after_isp') return m.live_where_after_isp()
  if (zone === 'not_home') return m.live_where_not_home()
  if (zone === 'isp' || zone === 'transit' || zone === 'service') {
    if (name) return m.verdict_where_operator({ operator: name })
    return zone === 'isp'
      ? m.live_where_isp()
      : zone === 'transit'
        ? m.live_where_transit()
        : m.live_where_service()
  }
  return null
}

export function isAwayFromHome(zone: FaultZone | null): boolean {
  return zone != null && zone !== 'home' && zone !== 'unlocated'
}

export function readingMetric(reading: LiveReading, cause: IncidentCause | null): string | null {
  return metricText({
    cause,
    atLeast: reading.atLeast,
    pingMs: reading.medianMs,
    usualMs: reading.usual.medianMs ?? reading.traceMs,
    lossPct: reading.lossPct ?? reading.lossFloorPct,
    jitterMs: reading.jitterMs,
  })
}

function joinTitle(parts: (string | null)[], away: boolean): string {
  const title = parts.filter(Boolean).join(' ')
  return away ? `${title}, ${m.live_not_home()}` : title
}

function adviceFor(zone: FaultZone | null): string[] {
  switch (zone) {
    case 'home':
      return [m.verdict_advice_home()]
    case 'isp':
    case 'not_home':
      return [m.verdict_advice_isp()]
    case 'transit':
    case 'after_isp':
      return [m.verdict_advice_transit()]
    case 'service':
      return [m.verdict_advice_service()]
    default:
      return []
  }
}

function zoneName(zone: RouteZone, evidence: ZoneEvidence | undefined): string {
  const operator = shortOperatorName(evidence?.operator)
  return operator ? `${zoneLabel(zone)} (${operator})` : zoneLabel(zone)
}

function zoneView(
  zone: RouteZone,
  evidence: ZoneEvidence | undefined,
  status: LiveStatus
): VerdictZone {
  const name = zoneName(zone, evidence)
  if (!evidence) return { status: null, name, note: m.verdict_zone_none() }
  switch (evidence.verdict) {
    case 'clear':
      return { status: 'ok', name, note: severityLabel('ok') }
    case 'fault': {
      const reading = status.points.find(point => point.point === evidence.point)
      const loss = reading ? (reading.lossPct ?? reading.lossFloorPct) : null
      const note =
        status.cause === 'loss' && loss != null
          ? m.verdict_zone_loss({ loss: formatLoss(loss) })
          : severityLabel(evidence.status)
      return { status: evidence.status, name, note }
    }
    case 'suspect':
      return { status: evidence.status, name, note: m.live_zone_suspect() }
    case 'masked':
      return { status: 'unmeasured', name, note: m.verdict_zone_masked() }
    default:
      return {
        status: 'unmeasured',
        name,
        note: evidence.silent ? m.hop_silent() : severityLabel('unmeasured'),
      }
  }
}

export function liveZones(status: LiveStatus): Record<RouteZone, VerdictZone> {
  return Object.fromEntries(
    ZONES.map(zone => [
      zone,
      zoneView(
        zone,
        status.zones.find(evidence => evidence.zone === zone),
        status
      ),
    ])
  ) as Record<RouteZone, VerdictZone>
}

function basisSentence(reading: LiveReading): string {
  if (reading.point === 'game') return m.live_body_game()
  if (!reading.atLeast) return m.live_body_server()
  const hop = readingHop(reading)
  if (hop == null) return m.live_body_router()
  const operator = readingOperator(reading)
  return operator
    ? m.verdict_silent({ hop: String(hop), operator })
    : m.verdict_silent_hop({ hop: String(hop) })
}

export function liveVerdict(status: LiveStatus): LiveVerdict | null {
  const primary = status.primary
  if (status.state !== 'live' || !primary) return null

  const zones = liveZones(status)
  const fault = status.fault
  const masked = status.zones.some(evidence => evidence.verdict === 'masked')
  const body = [basisSentence(primary), masked ? m.live_body_masked() : null]
    .filter(Boolean)
    .join(' ')

  if (status.status === 'ok' || status.status === 'unmeasured') {
    const loss = formatLoss(primary.lossPct ?? primary.lossFloorPct)
    const ping = readingPing(primary)
    const reference = primary.usual.medianMs ?? primary.traceMs
    const title =
      reference != null
        ? m.live_verdict_ok_usual({
            ping,
            usual: formatMs(reference, { digits: 0, atLeast: primary.atLeast }),
            loss,
          })
        : m.live_verdict_ok({ ping, loss })
    return { status: status.status, title, body, advice: [], zone: null, zones }
  }

  const cause = status.cause ?? primary.cause
  const at = (fault && status.points.find(point => point.point === fault.atPoint)) || primary
  const metric = readingMetric(at, cause) ?? severityLabel(status.status)
  const since = sinceMatchStart(status, status.statusSince)
  const zone = fault?.zone ?? null
  const title = joinTitle(
    [metric, whereText(zone, fault?.operator ?? null), since ? m.live_since({ since }) : null],
    isAwayFromHome(zone)
  )
  const located = zone && (ZONES as string[]).includes(zone) ? (zone as RouteZone) : null

  return {
    status: status.status,
    title,
    body,
    advice: adviceFor(zone),
    zone: located,
    zones,
  }
}

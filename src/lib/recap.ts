import * as m from '@/paraglide/messages'
import type {
  MatchIncident,
  MatchRecap,
  OperatorRoute,
  PingBasis,
  RecapPoint,
  SessionMatch,
  Severity,
} from '@/types/backend'
import { formatDuration, formatElapsed, formatMs, formatNumber } from '@/lib/format'
import { formatLoss, severityRank } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { formatRouteMs, segmentAt, segmentName, zoneLabel } from '@/lib/route'

const RECENT_MATCH_MS = 60 * 60_000

export function hasRecap(recap: MatchRecap | null | undefined): recap is MatchRecap {
  return recap != null && recap.points.length > 0
}

export function primaryPoint(recap: MatchRecap): RecapPoint | null {
  return recap.points.find(point => point.point === recap.primary) ?? null
}

function elapsedSecs(recap: MatchRecap, iso: string): number {
  return Math.max(0, Math.round((Date.parse(iso) - Date.parse(recap.startedAt)) / 1000))
}

export function formatAt(recap: MatchRecap, iso: string): string {
  return formatElapsed(elapsedSecs(recap, iso))
}

export function incidentSecs(incident: MatchIncident, recap: MatchRecap): number {
  const end = Date.parse(incident.endedAt ?? recap.endedAt)
  return Math.max(1, Math.round((end - Date.parse(incident.startedAt)) / 1000))
}

export function incidentWhere(incident: MatchIncident): string | null {
  const operator = shortOperatorName(incident.operator)
  switch (incident.zone) {
    case 'home':
      return m.recap_where_home()
    case 'isp':
      return m.recap_where_isp()
    case 'transit':
      return operator ? m.recap_where_operator({ operator }) : m.recap_where_transit()
    case 'service':
      return m.recap_where_service()
    case 'after_isp':
      return m.recap_where_after_isp()
    case 'not_home':
      return m.recap_where_not_home()
    default:
      return null
  }
}

export function incidentBasisNote(basis: PingBasis): string | null {
  if (basis.source === 'game') return m.ping_by_game()
  if (basis.atDestination || basis.measuredHop == null) return null
  return m.measured_up_to_hop({ hop: String(basis.measuredHop) })
}

export function incidentValues(incident: MatchIncident): string {
  const parts: string[] = []
  if (incident.pingMs != null) {
    parts.push(m.recap_value_ping({ value: formatRouteMs(incident.pingMs, incident.atLeast) }))
  }
  if (incident.lossPct != null && incident.lossPct > 0) {
    parts.push(m.recap_value_loss({ value: formatLoss(incident.lossPct) }))
  }
  if (incident.jitterMs != null) {
    parts.push(m.recap_value_jitter({ value: formatMs(incident.jitterMs) }))
  }
  return parts.join(' · ')
}

export function longestIncident(recap: MatchRecap): MatchIncident | null {
  return recap.incidents.reduce<MatchIncident | null>(
    (best, incident) =>
      !best || incidentSecs(incident, recap) > incidentSecs(best, recap) ? incident : best,
    null
  )
}

export function recapStatus(recap: MatchRecap): Severity {
  if (recap.points.length === 0) return 'unmeasured'
  return recap.incidents.reduce<Severity>(
    (worst, incident) =>
      severityRank(incident.status) > severityRank(worst) ? incident.status : worst,
    'ok'
  )
}

function pingPart(point: RecapPoint): string | null {
  if (point.pingMs == null) return null
  const ping = formatRouteMs(point.pingMs, point.atLeast)
  if (point.point === 'game') return m.recap_title_game({ ping })
  if (point.basis.atDestination || point.basis.measuredHop == null) {
    return m.recap_title_server({ ping })
  }
  return m.recap_title_floor({ ping, hop: String(point.basis.measuredHop) })
}

function lossPart(recap: MatchRecap, point: RecapPoint): string | null {
  const loss =
    point.lossPct ?? recap.points.find(other => other.lossPct != null && other.sent > 0)?.lossPct
  return loss == null ? null : m.recap_title_loss({ loss: formatLoss(loss) })
}

function incidentPart(recap: MatchRecap): string {
  const longest = longestIncident(recap)
  if (!longest) return m.recap_title_no_incident()
  const where = incidentWhere(longest)
  const params = {
    duration: formatDuration(incidentSecs(longest, recap)),
    where: where ? ` ${where}` : '',
    at: formatAt(recap, longest.startedAt),
  }
  return recap.incidents.length === 1
    ? m.recap_title_incident_one(params)
    : m.recap_title_incident_other({ ...params, count: String(recap.incidents.length) })
}

export function recapHeadline(recap: MatchRecap): string {
  const point = hasRecap(recap) ? (primaryPoint(recap) ?? recap.points[0]) : null
  if (!point) return m.recap_title_unmeasured()
  const parts = [pingPart(point), lossPart(recap, point), incidentPart(recap)].filter(
    (part): part is string => part != null
  )
  const [first, ...rest] = parts
  return [first.charAt(0).toLocaleUpperCase() + first.slice(1), ...rest].join(', ')
}

export function pointLabel(point: RecapPoint, route?: OperatorRoute | null): string {
  switch (point.point) {
    case 'game':
      return m.recap_point_game()
    case 'gateway':
      return m.recap_point_gateway()
    case 'isp_edge':
      return m.recap_point_isp_edge()
    default: {
      const hop = point.basis.measuredHop
      if (point.basis.atDestination || hop == null) return m.recap_point_server()
      const segment = segmentAt(route, hop)
      const operator = segment && (segmentName(segment) ?? zoneLabel(segment.zone))
      return operator
        ? m.recap_point_hop_operator({ hop: String(hop), operator })
        : m.recap_point_hop({ hop: String(hop) })
    }
  }
}

export function pointVolume(point: RecapPoint): string | null {
  if (point.sent <= 0) return null
  const count = formatNumber(point.sent)
  return point.point === 'game' ? m.recap_packets({ count }) : m.recap_probes({ count })
}

export function recentMatch(
  matches: SessionMatch[],
  now: number = Date.now()
): SessionMatch | undefined {
  const last = matches[matches.length - 1]
  if (!last) return undefined
  const age = now - Date.parse(last.endedAt)
  return age >= -60_000 && age <= RECENT_MATCH_MS ? last : undefined
}

export function matchStartingAt(
  matches: SessionMatch[],
  startedAt: string
): SessionMatch | undefined {
  const target = Date.parse(startedAt)
  return matches.reduce<SessionMatch | undefined>((best, match) => {
    const gap = Math.abs(Date.parse(match.startedAt) - target)
    return !best || gap < Math.abs(Date.parse(best.startedAt) - target) ? match : best
  }, undefined)
}

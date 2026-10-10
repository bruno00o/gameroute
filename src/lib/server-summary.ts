import * as m from '@/paraglide/messages'
import type { ServerIncident, ServerSummaryItem, Severity } from '@/types/backend'
import { formatClock, formatDay } from '@/lib/format'
import { formatLoss, isRiot, severityRank } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { formatRouteMs } from '@/lib/route'

type CountMessage = (params: { count: string }) => string

function counted(count: number, one: CountMessage, other: CountMessage): string {
  const params = { count: String(count) }
  return count === 1 ? one(params) : other(params)
}

export function serverName(server: ServerSummaryItem): string {
  const name =
    shortOperatorName(server.operator) ??
    (server.asn != null ? `AS${server.asn}` : (server.ips[0] ?? '—'))
  const riot = isRiot({ asn: server.asn, name: server.operator, city: null, country: null })
  return server.city && !riot ? `${name}, ${server.city}` : name
}

function upToLastHop(server: ServerSummaryItem): boolean {
  return server.basis != null && !server.basis.atDestination
}

export function formatServerPing(server: ServerSummaryItem): string | null {
  return server.recent ? formatRouteMs(server.recent.medianMs, upToLastHop(server)) : null
}

export function formatServerUsual(server: ServerSummaryItem): string | null {
  return server.usual.medianMs == null
    ? null
    : formatRouteMs(server.usual.medianMs, upToLastHop(server))
}

export function incidentCause(incident: ServerIncident): string {
  if (incident.cause === 'loss') return m.home_incident_loss({ loss: formatLoss(incident.lossPct) })
  const atLeast = !incident.basis.atDestination
  const ping = formatRouteMs(incident.pingMs, atLeast)
  return incident.usual.medianMs == null
    ? m.home_incident_ping({ ping })
    : m.home_incident_ping_usual({ ping, usual: formatRouteMs(incident.usual.medianMs, atLeast) })
}

function localDay(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function incidentSource(incident: ServerIncident): string {
  const time = formatClock(incident.measuredAt)
  return localDay(incident.measuredAt) === localDay(incident.startedAt)
    ? m.home_source_time({ time })
    : m.home_source_day({ date: formatDay(incident.measuredAt), time })
}

export type HomeVerdict = {
  status: Severity
  title: string
  scope: string
  sentences: string[]
}

function mostPlayed(servers: ServerSummaryItem[]): ServerSummaryItem {
  return servers.reduce((best, server) => (server.matchCount > best.matchCount ? server : best))
}

function rank(server: ServerSummaryItem): number {
  return server.status ? severityRank(server.status) : -1
}

export function homeVerdict(servers: ServerSummaryItem[], days: number): HomeVerdict | null {
  const played = servers.filter(server => server.status != null)
  if (played.length === 0) return null

  const matches = played.reduce((sum, server) => sum + server.matchCount, 0)
  const scope = [
    m.home_window({ count: String(days) }),
    counted(matches, m.session_matches_count_one, m.session_matches_count_other),
    counted(played.length, m.session_servers_count_one, m.session_servers_count_other),
  ].join(', ')

  const measured = played.filter(server => server.recent != null)
  if (measured.length === 0) {
    return {
      status: 'unmeasured',
      title:
        matches === 1
          ? m.home_verdict_unmeasured_one()
          : m.verdict_title_unmeasured_other({ count: String(matches) }),
      scope,
      sentences: [m.match_why_unmeasured_body()],
    }
  }

  const worst = Math.max(...measured.map(rank))
  const candidates = measured.filter(server => rank(server) === worst)
  const reference = worst > 0 ? candidates[0] : mostPlayed(candidates)
  const recent = reference.recent!
  const where = `${reference.gameName}, ${serverName(reference)}`
  const ping = formatServerPing(reference)!
  const usual = formatServerUsual(reference)
  const loss =
    recent.lossPct > 0 ? m.home_loss({ loss: formatLoss(recent.lossPct) }) : m.home_no_loss()

  const total = String(measured.length)
  const over = measured.filter(server => rank(server) > 0).length
  const spread =
    measured.length < 2
      ? null
      : worst <= 0
        ? m.home_all_under({ total })
        : over === 1
          ? m.home_over_one({ total })
          : m.home_over_other({ count: String(over), total })

  const basis = reference.basis
  const silent =
    basis && !basis.atDestination && basis.measuredHop != null
      ? m.verdict_silent_hop({ hop: String(basis.measuredHop) })
      : null
  const unmeasured = played.length - measured.length
  const unmeasuredSentence =
    unmeasured > 0 ? counted(unmeasured, m.home_unmeasured_one, m.home_unmeasured_other) : null

  return {
    status: reference.status!,
    title: usual
      ? m.home_verdict_title_usual({ ping, where, usual, loss })
      : m.home_verdict_title({ ping, where, loss }),
    scope,
    sentences: [spread, silent, unmeasuredSentence].filter(
      (sentence): sentence is string => sentence != null
    ),
  }
}

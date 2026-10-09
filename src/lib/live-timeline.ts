import type { LiveStatus, MatchIncident, Severity } from '@/types/backend'
import { matchElapsed, parseTime, sinceMatchStart } from '@/lib/live'
import { metricText, whereText } from '@/lib/live-verdict'
import { severityRank } from '@/lib/matches'

export const SLICE_SECS = 30

export type TimelineCell = { index: number; fromSecs: number; status: Severity }

export type TimelineEvent = {
  id: number
  status: Severity
  from: string
  to: string | null
  label: string
}

export function matchIncidents(status: LiveStatus, incidents: MatchIncident[]): MatchIncident[] {
  return incidents.filter(
    incident =>
      incident.sessionId === status.sessionId &&
      incident.serverIp === status.serverIp &&
      incident.matchStartedAt === status.matchStartedAt
  )
}

export function timelineCells(status: LiveStatus, incidents: MatchIncident[]): TimelineCell[] {
  const start = parseTime(status.matchStartedAt)
  const now = parseTime(status.updatedAt)
  const elapsed = matchElapsed(status)
  if (start == null || now == null || elapsed == null) return []

  const frozenFrom = status.state === 'frozen' ? parseTime(status.lastSampleAt) : null
  const spans = incidents.flatMap(incident => {
    const from = parseTime(incident.startedAt)
    return from == null
      ? []
      : [{ from, to: parseTime(incident.endedAt) ?? now, status: incident.status }]
  })
  const count = Math.max(1, Math.ceil(elapsed / SLICE_SECS))

  return Array.from({ length: count }, (_, index) => {
    const fromSecs = index * SLICE_SECS
    const from = start + fromSecs * 1000
    const to = from + SLICE_SECS * 1000
    let worst: Severity = 'ok'
    for (const span of spans) {
      if (span.from < to && span.to > from && severityRank(span.status) > severityRank(worst)) {
        worst = span.status
      }
    }
    if (worst === 'ok' && frozenFrom != null && from >= frozenFrom) worst = 'unmeasured'
    return { index, fromSecs, status: worst }
  })
}

export function incidentLabel(incident: MatchIncident): string {
  const metric = metricText({
    cause: incident.cause,
    atLeast: incident.atLeast,
    pingMs: incident.pingMs,
    usualMs: incident.usualMs,
    lossPct: incident.lossPct,
    jitterMs: incident.jitterMs,
  })
  const where = whereText(incident.zone, incident.operator)
  return [metric, where].filter(Boolean).join(' ')
}

export function timelineEvents(status: LiveStatus, incidents: MatchIncident[]): TimelineEvent[] {
  return [...incidents]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(incident => ({
      id: incident.id,
      status: incident.status,
      from: sinceMatchStart(status, incident.startedAt) ?? '—',
      to: sinceMatchStart(status, incident.endedAt),
      label: incidentLabel(incident),
    }))
}

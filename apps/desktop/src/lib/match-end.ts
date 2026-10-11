import * as m from '@/paraglide/messages'
import type { MatchIncident, RecapMode } from '@/types/backend'
import { formatDuration, formatElapsed } from '@/lib/format'

export type MatchEndKind = 'clean' | 'degraded' | 'critical'

export type MatchEndSummary = {
  kind: MatchEndKind
  seconds: number
  worst: MatchIncident | null
}

const causeLabels = {
  loss: m.match_end_cause_loss,
  latency: m.match_end_cause_latency,
  jitter: m.match_end_cause_jitter,
}

function secondsBetween(from: string, to: string | number): number {
  const end = typeof to === 'number' ? to : new Date(to).getTime()
  return Math.max(0, Math.round((end - new Date(from).getTime()) / 1000))
}

function lengthOf(incident: MatchIncident, now: number): number {
  return secondsBetween(incident.startedAt, incident.endedAt ?? now)
}

export function summarizeMatch(
  incidents: MatchIncident[],
  matchStartedAt: string,
  now: number
): MatchEndSummary {
  const felt = incidents.filter(
    incident =>
      incident.matchStartedAt === matchStartedAt &&
      (incident.status === 'degraded' || incident.status === 'critical')
  )
  const seconds = felt.reduce((total, incident) => total + lengthOf(incident, now), 0)
  const worst =
    [...felt].sort(
      (a, b) =>
        Number(b.status === 'critical') - Number(a.status === 'critical') ||
        lengthOf(b, now) - lengthOf(a, now)
    )[0] ?? null
  const kind = !worst ? 'clean' : worst.status === 'critical' ? 'critical' : 'degraded'
  return { kind, seconds, worst }
}

export function shouldAnnounce(recap: RecapMode, summary: MatchEndSummary): boolean {
  if (recap === 'never') return false
  return recap === 'always' || summary.kind !== 'clean'
}

export function matchEndMessage(
  summary: MatchEndSummary,
  matchStartedAt: string,
  now: number
): { title: string; description: string } {
  const { kind, seconds, worst } = summary
  if (kind === 'clean' || !worst) {
    return { title: m.match_end_title_clean(), description: m.match_end_body_clean() }
  }
  const duration = formatDuration(seconds)
  const title =
    kind === 'critical'
      ? m.match_end_title_critical({ duration })
      : m.match_end_title_degraded({ duration })
  const times = {
    from: formatElapsed(secondsBetween(matchStartedAt, worst.startedAt)),
    to: formatElapsed(secondsBetween(matchStartedAt, worst.endedAt ?? now)),
  }
  const cause = worst.cause ? causeLabels[worst.cause]() : null
  const fact = !cause
    ? ''
    : worst.operator
      ? m.match_end_fact_at({ cause, operator: worst.operator, ...times })
      : m.match_end_fact({ cause, ...times })
  return { title, description: m.match_end_body({ fact }).trim() }
}

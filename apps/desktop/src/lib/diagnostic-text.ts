import * as m from '@/paraglide/messages'
import type {
  OperatorRoute,
  SessionDetail,
  SessionMatch,
  SeverityThresholds,
} from '@/types/backend'
import {
  computeDurationSecs,
  formatClock,
  formatDay,
  formatDuration,
  formatElapsed,
  formatMs,
} from '@/lib/format'
import {
  flowProvenance,
  flowServerLabel,
  formatFlowPing,
  formatLoss,
  matchMeasure,
  sessionSpan,
  sessionVerdict,
  severityLabel,
  traceOf,
  traceTiming,
  traceTimingText,
} from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { formatRouteMs, segmentName, zoneLabel } from '@/lib/route'

function routeLine(route: OperatorRoute): string {
  const stops = route.segments.map(segment => {
    const name = segmentName(segment)
    const asn = segment.asn != null ? ` (AS${segment.asn})` : ''
    const label = name ? `${zoneLabel(segment.zone)}, ${name}${asn}` : zoneLabel(segment.zone)
    return `${label} +${formatRouteMs(segment.addedMs)}`
  })
  if (route.destinationSilent) {
    const destination = shortOperatorName(route.destinationName) ?? zoneLabel('service')
    stops.push(`${destination} (${m.diagnostic_silent()})`)
  }
  return `${stops.join(' → ')} = ${formatRouteMs(route.totalMs, route.destinationSilent)}`
}

export function sessionDiagnostic(
  detail: SessionDetail,
  matches: SessionMatch[],
  thresholds?: SeverityThresholds | null
): string {
  const lines: string[] = []
  const duration = formatDuration(computeDurationSecs(detail.startedAt, detail.endedAt))

  lines.push(m.diagnostic_title({ game: detail.gameName }))
  lines.push(
    `${formatDay(detail.startedAt, { weekday: true })}, ${sessionSpan(detail)}, ${duration}`
  )

  const verdict = sessionVerdict(matches, detail.traceroutes, thresholds, detail.endedAt === null)
  if (!verdict) {
    lines.push('', m.matches_empty_title())
    return lines.join('\n')
  }

  lines.push('', `${severityLabel(verdict.status)}: ${verdict.title}`)
  if (verdict.sentences.length > 0) lines.push(verdict.sentences.join(' '))

  const reference = verdict.reference
  const route = reference && traceOf(reference, detail.traceroutes)?.route
  if (reference && route) {
    const timing = traceTiming(reference, matches, detail.endedAt)
    const when = timing ? ` (${traceTimingText(timing)})` : ''
    lines.push('', `${m.session_route()}${when}`, routeLine(route))
  }

  lines.push('', `${m.session_matches()}: ${verdict.scope}`)
  for (const match of matches) {
    const provenance = flowProvenance(match, matches, detail.traceroutes, detail.endedAt, {
      withOffset: true,
    })
    const trace = matchMeasure(match)
    const parts = [
      `${match.number}. ${formatClock(match.startedAt)}`,
      formatElapsed(match.durationSecs),
      flowServerLabel(match),
      m.diagnostic_ping({ value: formatFlowPing(trace) }) +
        (provenance.length ? ` (${provenance.join(', ')})` : ''),
      m.diagnostic_loss({ value: formatLoss(trace?.lossPct) }),
      m.diagnostic_jitter({ value: formatMs(trace?.jitterMs) }),
      severityLabel(match.status),
    ]
    if (match.voice) {
      parts.push(
        m.diagnostic_voice({
          server: flowServerLabel(match.voice),
          value: formatFlowPing(match.voice.trace),
        })
      )
    }
    lines.push(parts.join(', '))
  }

  lines.push('', m.matches_note())
  return lines.join('\n')
}

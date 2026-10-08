import * as m from '@/paraglide/messages'
import { getLocale, type Locale } from '@/paraglide/runtime'
import type {
  DbHop,
  OperatorRoute,
  RouteZone,
  SessionDetail,
  SessionMatch,
  TracerouteWithHops,
} from '@/types/backend'
import {
  computeDurationSecs,
  formatClock,
  formatDay,
  formatDuration,
  formatElapsed,
  formatMs,
  formatPercent,
} from '@/lib/format'
import { flowServerName, traceOf, traceTiming, usualPing } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { lastRespondingHop, segmentAt, segmentName } from '@/lib/route'

export const PERSISTENT_LOSS_MIN_PCT = 10

export type ReportRecipient = 'isp' | 'publisher' | 'forum'

export type ReportSource = {
  detail: SessionDetail
  matches: SessionMatch[]
  match: SessionMatch
}

export type ReportOptions = {
  recipient: ReportRecipient
  route: boolean
  hops: boolean
  addresses: boolean
  locale?: Locale
  now?: Date
}

type Entry = {
  source: ReportSource
  trace: TracerouteWithHops | undefined
}

const INDENT = '  '

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: string | null = null
  for (const [value, count] of counts) if (best == null || count > counts.get(best)!) best = value
  return best
}

export function reportIspName(sources: ReportSource[]): string | null {
  return mostCommon(
    sources.map(({ detail, match }) => {
      const segment = traceOf(match, detail.traceroutes)?.route?.segments.find(
        item => item.zone === 'isp'
      )
      return segment ? segmentName(segment) : null
    })
  )
}

export function reportPublisherName(sources: ReportSource[]): string | null {
  return mostCommon(sources.map(({ match }) => shortOperatorName(match.operator?.name)))
}

function isPrivateAddress(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\./)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168)
    )
  }
  const lower = ip.toLowerCase()
  return lower === '::1' || lower.startsWith('fe80:') || /^f[cd]/.test(lower)
}

export function reportText(sources: ReportSource[], options: ReportOptions): string {
  const locale = options.locale ?? getLocale()
  const now = options.now ?? new Date()
  const tr = { locale }

  const ms = (value: number | null | undefined, atLeast = false) =>
    formatMs(value, { digits: value != null && Math.abs(value) < 10 ? 1 : 0, atLeast, locale })
  const loss = (value: number) => {
    const fraction = value > 0 && value < 10 && Math.round(value * 10) % 10 !== 0
    return formatPercent(value, { digits: fraction ? 1 : 0, locale })
  }
  const zone = (item: RouteZone) => {
    const labels: Record<RouteZone, () => string> = {
      home: () => m.route_zone_home({}, tr),
      isp: () => m.route_zone_isp({}, tr),
      transit: () => m.route_zone_transit({}, tr),
      service: () => m.route_zone_service({}, tr),
    }
    return labels[item]()
  }
  const day = (iso: string) => formatDay(iso, { locale, now })
  const stop = (hop: number, operator: string | null) =>
    operator
      ? m.report_stop({ hop: String(hop), operator }, tr)
      : m.report_stop_hop({ hop: String(hop) }, tr)
  const operatorAt = (route: OperatorRoute | null | undefined, hop: number) => {
    const segment = segmentAt(route, hop)
    return segment ? (segmentName(segment) ?? zone(segment.zone)) : null
  }

  const ordered = [...sources].sort(
    (a, b) => Date.parse(a.match.startedAt) - Date.parse(b.match.startedAt)
  )
  const entries: Entry[] = ordered.map(source => ({
    source,
    trace: traceOf(source.match, source.detail.traceroutes),
  }))

  const matchLabel = ({ match, detail }: ReportSource) =>
    m.report_match_label(
      { game: detail.gameName, day: day(match.startedAt), number: String(match.number) },
      tr
    )

  const lines: string[] = [m.report_title({}, tr)]
  const prepared = m.report_prepared(
    {
      date: new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(now),
      time: formatClock(now.toISOString(), locale),
    },
    tr
  )
  const addressee = (() => {
    if (options.recipient === 'forum') return m.report_for_forum({}, tr)
    if (options.recipient === 'isp') {
      const name = reportIspName(ordered)
      return name ? m.report_for_support({ name }, tr) : m.report_for_isp_unknown({}, tr)
    }
    const name = reportPublisherName(ordered)
    return name ? m.report_for_support({ name }, tr) : m.report_for_publisher_unknown({}, tr)
  })()
  lines.push(`${prepared} · ${addressee}`)

  if (entries.length === 0) {
    lines.push('', m.report_empty({}, tr))
    return lines.join('\n')
  }

  const measured = entries.filter(entry => entry.source.match.trace?.pingMs != null)
  const unmeasured = entries.length - measured.length
  const withLoss = measured.filter(entry => (entry.source.match.trace?.lossPct ?? 0) > 0)

  const games = [...new Set(entries.map(entry => entry.source.detail.gameName))]
  const first = ordered[0].match.startedAt
  const last = ordered[ordered.length - 1].match.startedAt
  const period = day(first) === day(last) ? day(first) : `${day(first)} → ${day(last)}`
  const count = String(entries.length)
  const matchesLine = (
    entries.length === 1 ? m.report_summary_matches_one : m.report_summary_matches_other
  )({ count, games: games.join(', ') }, tr)

  lines.push('', m.report_section_summary({}, tr), `${matchesLine} · ${period}`)

  const lossOrigin = (entry: Entry): string[] => {
    const { trace } = entry
    const route = trace?.route
    const onset = trace?.hops.find(hop => hop.latencyAvg != null && hop.lossStatus != null)
    if (!onset) return []
    const segment = segmentAt(route, onset.hopNumber)
    const operator = operatorAt(route, onset.hopNumber)
    const index = segment && route ? route.segments.indexOf(segment) : -1
    const previous = index > 0 ? route!.segments[index - 1] : null
    return [
      operator
        ? m.report_loss_from_hop({ hop: String(onset.hopNumber), operator }, tr)
        : m.report_loss_from_hop_plain({ hop: String(onset.hopNumber) }, tr),
      ...(previous
        ? [m.report_loss_after({ operator: segmentName(previous) ?? zone(previous.zone) }, tr)]
        : []),
    ]
  }

  for (const entry of withLoss) {
    const origin = lossOrigin(entry)
    lines.push(
      m.report_summary_loss(
        {
          match: matchLabel(entry.source),
          loss: loss(entry.source.match.trace!.lossPct!),
          from: origin.length ? `, ${origin.join(', ')}` : '',
        },
        tr
      )
    )
  }
  if (measured.length > 0 && withLoss.length === 0) {
    lines.push(m.report_summary_no_loss({}, tr))
  } else if (withLoss.length > 0 && withLoss.length < measured.length) {
    lines.push(m.report_summary_no_loss_others({}, tr))
  }
  if (measured.length > 1) {
    const pings = measured.map(entry => entry.source.match.trace!)
    const low = pings.reduce((a, b) => (b.pingMs! < a.pingMs! ? b : a))
    const high = pings.reduce((a, b) => (b.pingMs! > a.pingMs! ? b : a))
    if (low.pingMs !== high.pingMs) {
      lines.push(
        m.report_summary_ping(
          { min: ms(low.pingMs, !low.atDestination), max: ms(high.pingMs, !high.atDestination) },
          tr
        )
      )
    }
  }
  if (unmeasured > 0) {
    lines.push(
      (unmeasured === 1 ? m.report_summary_unmeasured_one : m.report_summary_unmeasured_other)(
        { count: String(unmeasured) },
        tr
      )
    )
  }

  lines.push('', m.report_section_matches({}, tr))

  const routeLine = (route: OperatorRoute) => {
    const stops = route.segments.map(segment => {
      const name = segmentName(segment)
      const asn = segment.asn != null ? ` (AS${segment.asn})` : ''
      const label = name ? `${zone(segment.zone)} · ${name}${asn}` : zone(segment.zone)
      return `${label} +${ms(segment.addedMs)}`
    })
    if (route.destinationSilent) {
      const destination = shortOperatorName(route.destinationName) ?? zone('service')
      stops.push(`${destination} (${m.diagnostic_silent({}, tr)})`)
    }
    return `${stops.join(' → ')} = ${ms(route.totalMs, route.destinationSilent)}`
  }

  const hopLine = (hop: DbHop, trace: TracerouteWithHops) => {
    const segment = segmentAt(trace.route, hop.hopNumber)
    const home = segment?.zone === 'home' || (hop.ip != null && isPrivateAddress(hop.ip))
    const label = home
      ? zone('home')
      : segment
        ? (segmentName(segment) ?? zone(segment.zone))
        : null
    const address = (() => {
      if (home && !options.addresses) return null
      const ip = hop.ip
      if (hop.hostname && ip && hop.hostname !== ip) return `${hop.hostname} (${ip})`
      return hop.hostname ?? ip
    })()
    const parts: (string | null)[] = [String(hop.hopNumber), label, address]
    if (hop.latencyAvg == null) {
      parts.push(m.hop_silent_router({}, tr))
    } else {
      parts.push(formatMs(hop.latencyAvg, { locale }))
      if (hop.lossStatus != null) {
        parts.push(
          `${m.diagnostic_loss({ value: formatPercent(hop.packetLoss, { locale }) }, tr)} (${m.report_hop_persistent({}, tr)})`
        )
      } else if ((hop.packetLoss ?? 0) > 0) {
        parts.push(m.hop_rate_limited({}, tr))
      }
    }
    return `${INDENT}${INDENT}${parts.filter(part => part != null).join(' · ')}`
  }

  for (const entry of entries) {
    const { source, trace } = entry
    const { match, detail, matches } = source
    const measure = match.trace
    const port = match.port > 0 ? `${match.protocol} ${match.port}` : match.protocol
    const asn = match.operator?.asn != null ? ` (AS${match.operator.asn})` : ''
    const span = `${formatClock(match.startedAt, locale)} → ${formatClock(match.endedAt, locale)}`

    lines.push(
      '',
      matchLabel(source),
      `${INDENT}${m.report_match_time({ span, duration: formatDuration(computeDurationSecs(match.startedAt, match.endedAt), locale) }, tr)}`,
      `${INDENT}${m.report_match_server({ server: `${flowServerName(match)}${asn} · ${match.ip} · ${port}` }, tr)}`
    )

    if (!measure || measure.pingMs == null) {
      lines.push(`${INDENT}${m.report_match_unmeasured({}, tr)}`)
      continue
    }

    const pingParts = [ms(measure.pingMs, !measure.atDestination)]
    if (!measure.atDestination && measure.measuredHop != null) {
      const operator = operatorAt(trace?.route, measure.measuredHop)
      pingParts.push(
        operator
          ? m.measured_up_to({ hop: String(measure.measuredHop), operator }, tr)
          : m.measured_up_to_hop({ hop: String(measure.measuredHop) }, tr)
      )
    }
    const usual = usualPing(measure)
    if (usual != null) {
      pingParts.push(
        m.report_ping_usual(
          { value: ms(usual, !measure.atDestination), count: String(measure.usual!.sampleCount) },
          tr
        )
      )
    }
    lines.push(`${INDENT}${m.report_match_ping({ value: pingParts.join(' · ') }, tr)}`)

    const lossPct = measure.lossPct ?? 0
    lines.push(
      INDENT +
        (lossPct > 0
          ? [m.report_match_loss({ loss: loss(lossPct) }, tr), ...lossOrigin(entry)].join(', ')
          : m.report_match_loss_none({}, tr))
    )
    if (measure.jitterMs != null) {
      lines.push(`${INDENT}${m.report_match_jitter({ value: ms(measure.jitterMs) }, tr)}`)
    }

    const timing = traceTiming(match, matches, detail.endedAt)
    if (timing) {
      const text = (() => {
        switch (timing.kind) {
          case 'during':
            return m.report_trace_during({ offset: formatElapsed(timing.offsetSecs) }, tr)
          case 'match':
            return m.report_trace_match({ number: String(timing.number) }, tr)
          case 'after':
            return m.report_trace_after({}, tr)
          case 'at':
            return m.report_trace_at({ time: formatClock(timing.time, locale) }, tr)
        }
      })()
      lines.push(`${INDENT}${text}`)
    }

    if (options.route && trace?.route) {
      lines.push(`${INDENT}${m.report_match_route({ route: routeLine(trace.route) }, tr)}`)
    }
    if (options.hops && trace && trace.hops.length > 0) {
      lines.push(`${INDENT}${m.report_match_hops({}, tr)}`)
      for (const hop of trace.hops) lines.push(hopLine(hop, trace))
      const silentDestination = trace.route
        ? trace.route.destinationSilent
        : !trace.hops.some(hop => hop.ip === trace.targetIp && hop.latencyAvg != null)
      if (silentDestination) {
        lines.push(
          `${INDENT}${INDENT}${[zone('service'), trace.targetIp, m.hop_silent_router({}, tr)].join(' · ')}`
        )
      }
    }
  }

  lines.push('', m.report_section_limits({}, tr), m.report_limit_method({}, tr))

  const lowerBounds = measured.filter(entry => !entry.source.match.trace!.atDestination)
  if (lowerBounds.length > 0) {
    const servers = [...new Set(lowerBounds.map(entry => flowServerName(entry.source.match)))]
    const stops = new Set<string>()
    for (const { source, trace } of lowerBounds) {
      const hop =
        source.match.trace!.measuredHop ?? (trace ? lastRespondingHop(trace.hops)?.hopNumber : null)
      if (hop != null) stops.add(stop(hop, operatorAt(trace?.route, hop)))
    }
    lines.push(
      m.report_limit_lower_bound({ servers: servers.join(', '), stops: [...stops].join('; ') }, tr)
    )
  }

  const hasQuietHops = entries.some(({ trace }) =>
    trace?.hops.some(
      hop => hop.latencyAvg == null || (hop.lossStatus == null && (hop.packetLoss ?? 0) > 0)
    )
  )
  if (options.hops && hasQuietHops) lines.push(m.report_limit_silent({}, tr))
  lines.push(
    m.report_limit_loss({ min: formatPercent(PERSISTENT_LOSS_MIN_PCT, { locale }) }, tr),
    '',
    m.report_section_context({}, tr),
    m.report_context_vantage({}, tr),
    m.report_context_link({}, tr),
    options.addresses ? m.report_context_unmasked({}, tr) : m.report_context_masked({}, tr)
  )

  return lines.join('\n')
}

export type ReportCandidate = {
  key: string
  sessionId: number
  gameName: string
  match: SessionMatch
}

export function reportCandidateKey(sessionId: number, number: number): string {
  return `${sessionId}:${number}`
}

const PROBLEM_STATUSES = new Set(['watch', 'degraded', 'critical'])

export function defaultReportSelection(
  candidates: ReportCandidate[],
  focusSessionId?: number
): string[] {
  const pool =
    focusSessionId == null
      ? candidates
      : candidates.filter(candidate => candidate.sessionId === focusSessionId)
  const measured = pool.filter(candidate => candidate.match.trace?.pingMs != null)
  const problems = measured.filter(candidate => PROBLEM_STATUSES.has(candidate.match.status))

  if (problems.length === 0) return measured.slice(0, 1).map(candidate => candidate.key)

  const selected = problems.slice(0, focusSessionId == null ? 3 : 5)
  const reference = candidates.find(
    candidate =>
      candidate.gameName === selected[0].gameName &&
      candidate.match.status === 'ok' &&
      candidate.match.trace?.pingMs != null
  )
  return [...selected, ...(reference ? [reference] : [])].map(candidate => candidate.key)
}

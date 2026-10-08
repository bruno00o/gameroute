import * as m from '@/paraglide/messages'
import { getLocale, type Locale } from '@/paraglide/runtime'
import type {
  DbHop,
  OperatorRoute,
  RouteZone,
  SessionDetail,
  SessionMatch,
  Severity,
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
import { flowServerName, matchMeasure, traceOf, traceTiming, usualPing } from '@/lib/matches'
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
const REGION_PINGS_SHOWN = 3

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

export type ReportFigures = {
  time: string
  ping: string | null
  loss: string | null
  jitter: string | null
}

export type ReportRouteSegment = {
  zone: string
  name: string | null
  asn: number | null
  added: string
  addedMs: number
  hops: string
  status: Severity | null
  note: string | null
}

export type ReportRoute = {
  line: string
  segments: ReportRouteSegment[]
  destination: { name: string; silent: boolean; silentLabel: string }
  total: string
  totalLabel: string
}

export type ReportHopRow = {
  text: string
  number: number | null
  zone: string | null
  address: string | null
  silent: boolean
  latency: string | null
  loss: string | null
  status: Severity | null
  note: string | null
}

export type ReportMatch = {
  label: string
  status: Severity
  lines: string[]
  figures: ReportFigures | null
  route: ReportRoute | null
  hops: { heading: string; rows: ReportHopRow[] } | null
}

export type ReportSection = { heading: string; lines: string[] }

export type ReportDocument = {
  title: string
  prepared: string
  empty: string | null
  summary: ReportSection
  matchesHeading: string
  matches: ReportMatch[]
  limits: ReportSection
  context: ReportSection
}

export function reportDocument(sources: ReportSource[], options: ReportOptions): ReportDocument {
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

  const title = m.report_title({}, tr)
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

  const headings = {
    summary: m.report_section_summary({}, tr),
    matches: m.report_section_matches({}, tr),
    limits: m.report_section_limits({}, tr),
    context: m.report_section_context({}, tr),
  }
  const document: ReportDocument = {
    title,
    prepared: `${prepared} · ${addressee}`,
    empty: null,
    summary: { heading: headings.summary, lines: [] },
    matchesHeading: headings.matches,
    matches: [],
    limits: { heading: headings.limits, lines: [] },
    context: { heading: headings.context, lines: [] },
  }

  if (entries.length === 0) {
    document.empty = m.report_empty({}, tr)
    return document
  }

  const measureOf = (entry: Entry) => matchMeasure(entry.source.match)
  const measured = entries.filter(entry => measureOf(entry)?.pingMs != null)
  const unmeasured = entries.length - measured.length
  const withLoss = measured.filter(entry => (entry.source.match.trace?.lossPct ?? 0) > 0)
  const withGameLoss = measured.filter(entry => (entry.source.match.game?.lossPct ?? 0) > 0)
  const anyGame = entries.some(entry => entry.source.match.game != null)
  const lossy = new Set([...withLoss, ...withGameLoss])

  const games = [...new Set(entries.map(entry => entry.source.detail.gameName))]
  const first = ordered[0].match.startedAt
  const last = ordered[ordered.length - 1].match.startedAt
  const period = day(first) === day(last) ? day(first) : `${day(first)} → ${day(last)}`
  const count = String(entries.length)
  const matchesLine = (
    entries.length === 1 ? m.report_summary_matches_one : m.report_summary_matches_other
  )({ count, games: games.join(', ') }, tr)

  const summary = document.summary.lines
  summary.push(`${matchesLine} · ${period}`)

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
    summary.push(
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
  for (const entry of withGameLoss) {
    const game = entry.source.match.game!
    summary.push(
      m.report_summary_loss_game(
        {
          match: matchLabel(entry.source),
          loss: loss(game.lossPct!),
          lost: String(game.packetsLost),
        },
        tr
      )
    )
  }
  if (measured.length > 0 && lossy.size === 0) {
    summary.push(m.report_summary_no_loss({}, tr))
  } else if (lossy.size > 0 && lossy.size < measured.length) {
    summary.push(m.report_summary_no_loss_others({}, tr))
  }
  if (measured.length > 1) {
    const pings = measured.map(entry => measureOf(entry)!)
    const low = pings.reduce((a, b) => (b.pingMs! < a.pingMs! ? b : a))
    const high = pings.reduce((a, b) => (b.pingMs! > a.pingMs! ? b : a))
    if (low.pingMs !== high.pingMs) {
      summary.push(
        m.report_summary_ping(
          { min: ms(low.pingMs, !low.atDestination), max: ms(high.pingMs, !high.atDestination) },
          tr
        )
      )
    }
  }
  if (unmeasured > 0) {
    summary.push(
      (unmeasured === 1 ? m.report_summary_unmeasured_one : m.report_summary_unmeasured_other)(
        { count: String(unmeasured) },
        tr
      )
    )
  }

  const routeOf = (route: OperatorRoute, persistentLoss: number | null | undefined) => {
    const stops = route.segments.map(segment => {
      const name = segmentName(segment)
      const asn = segment.asn != null ? ` (AS${segment.asn})` : ''
      const label = name ? `${zone(segment.zone)} · ${name}${asn}` : zone(segment.zone)
      return `${label} +${ms(segment.addedMs)}`
    })
    const destinationName = shortOperatorName(route.destinationName) ?? zone('service')
    if (route.destinationSilent) {
      stops.push(`${destinationName} (${m.diagnostic_silent({}, tr)})`)
    }
    const total = ms(route.totalMs, route.destinationSilent)
    const result: ReportRoute = {
      line: m.report_match_route({ route: `${stops.join(' → ')} = ${total}` }, tr),
      segments: route.segments.map(segment => {
        const status = segment.status && segment.status !== 'ok' ? segment.status : null
        return {
          zone: zone(segment.zone),
          name: segmentName(segment),
          asn: segment.asn,
          added: `+${ms(segment.addedMs)}`,
          addedMs: segment.addedMs,
          hops:
            segment.hops === 1
              ? m.route_hop_count_one({ count: '1' }, tr)
              : m.route_hop_count_other({ count: String(segment.hops) }, tr),
          status,
          note:
            status && persistentLoss != null
              ? m.route_loss_note(
                  {
                    loss: loss(persistentLoss),
                    hop: String(route.lastRespondingHop),
                  },
                  tr
                )
              : null,
        }
      }),
      destination: {
        name: destinationName,
        silent: route.destinationSilent,
        silentLabel: m.hop_silent({}, tr),
      },
      total,
      totalLabel: route.destinationSilent ? m.route_total_up_to({}, tr) : m.route_total_rtt({}, tr),
    }
    return result
  }

  const hopRow = (hop: DbHop, trace: TracerouteWithHops): ReportHopRow => {
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
    const row: ReportHopRow = {
      text: '',
      number: hop.hopNumber,
      zone: label,
      address,
      silent: hop.latencyAvg == null,
      latency: null,
      loss: null,
      status: null,
      note: null,
    }
    if (hop.latencyAvg == null) {
      row.note = m.hop_silent_router({}, tr)
      parts.push(row.note)
    } else {
      row.latency = formatMs(hop.latencyAvg, { locale })
      row.loss = formatPercent(hop.packetLoss, { locale })
      parts.push(row.latency)
      if (hop.lossStatus != null) {
        row.status = hop.lossStatus
        row.note = `${m.diagnostic_loss({ value: row.loss }, tr)} (${m.report_hop_persistent({}, tr)})`
        parts.push(row.note)
      } else if ((hop.packetLoss ?? 0) > 0) {
        row.note = m.hop_rate_limited({}, tr)
        parts.push(row.note)
      }
    }
    row.text = parts.filter(part => part != null).join(' · ')
    return row
  }

  for (const entry of entries) {
    const { source, trace } = entry
    const { match, detail, matches } = source
    const measure = matchMeasure(match)
    const game = match.game
    const port = match.port > 0 ? `${match.protocol} ${match.port}` : match.protocol
    const asn = match.operator?.asn != null ? ` (AS${match.operator.asn})` : ''
    const span = `${formatClock(match.startedAt, locale)} → ${formatClock(match.endedAt, locale)}`

    const block: ReportMatch = {
      label: matchLabel(source),
      status: match.status,
      lines: [
        m.report_match_time(
          {
            span,
            duration: formatDuration(computeDurationSecs(match.startedAt, match.endedAt), locale),
          },
          tr
        ),
        m.report_match_server(
          { server: `${flowServerName(match)}${asn} · ${match.ip} · ${port}` },
          tr
        ),
      ],
      figures: null,
      route: null,
      hops: null,
    }
    document.matches.push(block)
    const lines = block.lines

    const regionPings = (match.regionPings?.pings ?? []).slice(0, REGION_PINGS_SHOWN)
    const regionLine =
      regionPings.length > 0
        ? m.match_region_pings(
            {
              game: detail.gameName,
              pings: regionPings
                .map(item => `${item.region} ${formatMs(item.pingMs, { digits: 0, locale })}`)
                .join(' · '),
            },
            tr
          )
        : null

    if (!measure || measure.pingMs == null) {
      lines.push(m.report_match_unmeasured({}, tr))
      if (regionLine) lines.push(regionLine)
      continue
    }

    const exact = (value: number) =>
      game ? formatMs(value, { locale }) : ms(value, !measure.atDestination)
    const pingParts = [exact(measure.pingMs)]
    if (game) {
      const params = { game: detail.gameName, count: String(game.sampleCount) }
      pingParts.push(
        game.sampleCount === 1
          ? m.report_ping_by_game_one(params, tr)
          : m.report_ping_by_game_other(params, tr)
      )
    } else if (!measure.atDestination && measure.measuredHop != null) {
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
        m.report_ping_usual({ value: exact(usual), count: String(measure.usual!.sampleCount) }, tr)
      )
    }
    lines.push(m.report_match_ping({ value: pingParts.join(' · ') }, tr))

    const figures: ReportFigures = { time: span, ping: pingParts[0], loss: null, jitter: null }
    block.figures = figures

    if (game?.lossPct != null) {
      figures.loss = loss(game.lossPct)
      lines.push(
        m.report_match_loss_game({ loss: loss(game.lossPct), lost: String(game.packetsLost) }, tr)
      )
    }
    if (match.trace?.pingMs != null) {
      const lossPct = match.trace.lossPct ?? 0
      figures.loss ??= loss(lossPct)
      lines.push(
        lossPct > 0
          ? [m.report_match_loss({ loss: loss(lossPct) }, tr), ...lossOrigin(entry)].join(', ')
          : m.report_match_loss_none({}, tr)
      )
    }
    if (game?.jitterMs != null) {
      figures.jitter = ms(game.jitterMs)
      lines.push(m.report_match_jitter_game({ value: figures.jitter }, tr))
    } else if (match.trace?.jitterMs != null) {
      figures.jitter = ms(match.trace.jitterMs)
      lines.push(m.report_match_jitter({ value: figures.jitter }, tr))
    }
    if (regionLine) lines.push(regionLine)

    const timing = match.trace ? traceTiming(match, matches, detail.endedAt) : null
    if (timing) {
      lines.push(
        (() => {
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
      )
    }

    if (options.route && trace?.route) {
      block.route = routeOf(trace.route, match.trace?.lossPct)
    }
    if (options.hops && trace && trace.hops.length > 0) {
      const rows = trace.hops.map(hop => hopRow(hop, trace))
      const silentDestination = trace.route
        ? trace.route.destinationSilent
        : !trace.hops.some(hop => hop.ip === trace.targetIp && hop.latencyAvg != null)
      if (silentDestination) {
        const note = m.hop_silent_router({}, tr)
        rows.push({
          text: [zone('service'), trace.targetIp, note].join(' · '),
          number: null,
          zone: zone('service'),
          address: trace.targetIp,
          silent: true,
          latency: null,
          loss: null,
          status: null,
          note,
        })
      }
      block.hops = { heading: m.report_match_hops({}, tr), rows }
    }
  }

  const limits = document.limits.lines
  if (anyGame) {
    limits.push(m.report_limit_game({}, tr))
    if (entries.some(entry => entry.source.match.trace)) {
      limits.push(m.report_limit_method_route({}, tr))
    }
  } else {
    limits.push(m.report_limit_method({}, tr))
  }

  const regionGames = [
    ...new Set(
      entries
        .filter(entry => (entry.source.match.regionPings?.pings.length ?? 0) > 0)
        .map(entry => entry.source.detail.gameName)
    ),
  ]
  if (regionGames.length > 0) {
    limits.push(m.report_limit_region({ games: regionGames.join(', ') }, tr))
  }

  const lowerBounds = entries.filter(
    entry => entry.source.match.trace?.pingMs != null && !entry.source.match.trace.atDestination
  )
  if (lowerBounds.length > 0) {
    const servers = [...new Set(lowerBounds.map(entry => flowServerName(entry.source.match)))]
    const stops = new Set<string>()
    for (const { source, trace } of lowerBounds) {
      const hop =
        source.match.trace?.measuredHop ?? (trace ? lastRespondingHop(trace.hops)?.hopNumber : null)
      if (hop != null) stops.add(stop(hop, operatorAt(trace?.route, hop)))
    }
    limits.push(
      m.report_limit_lower_bound({ servers: servers.join(', '), stops: [...stops].join('; ') }, tr)
    )
  }

  const hasQuietHops = entries.some(({ trace }) =>
    trace?.hops.some(
      hop => hop.latencyAvg == null || (hop.lossStatus == null && (hop.packetLoss ?? 0) > 0)
    )
  )
  if (options.hops && hasQuietHops) limits.push(m.report_limit_silent({}, tr))
  limits.push(m.report_limit_loss({ min: formatPercent(PERSISTENT_LOSS_MIN_PCT, { locale }) }, tr))

  document.context.lines.push(
    m.report_context_vantage({}, tr),
    m.report_context_link({}, tr),
    options.addresses ? m.report_context_unmasked({}, tr) : m.report_context_masked({}, tr)
  )

  return document
}

export function renderReportText(document: ReportDocument): string {
  const lines = [document.title, document.prepared]
  if (document.empty != null) {
    lines.push('', document.empty)
    return lines.join('\n')
  }

  lines.push('', document.summary.heading, ...document.summary.lines)
  lines.push('', document.matchesHeading)
  for (const match of document.matches) {
    lines.push('', match.label, ...match.lines.map(line => `${INDENT}${line}`))
    if (match.route) lines.push(`${INDENT}${match.route.line}`)
    if (match.hops) {
      lines.push(
        `${INDENT}${match.hops.heading}`,
        ...match.hops.rows.map(row => `${INDENT}${INDENT}${row.text}`)
      )
    }
  }
  lines.push('', document.limits.heading, ...document.limits.lines)
  lines.push('', document.context.heading, ...document.context.lines)
  return lines.join('\n')
}

export function reportText(sources: ReportSource[], options: ReportOptions): string {
  return renderReportText(reportDocument(sources, options))
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
  const measured = pool.filter(candidate => matchMeasure(candidate.match)?.pingMs != null)
  const problems = measured.filter(candidate => PROBLEM_STATUSES.has(candidate.match.status))

  if (problems.length === 0) return measured.slice(0, 1).map(candidate => candidate.key)

  const selected = problems.slice(0, focusSessionId == null ? 3 : 5)
  const reference = candidates.find(
    candidate =>
      candidate.gameName === selected[0].gameName &&
      candidate.match.status === 'ok' &&
      matchMeasure(candidate.match)?.pingMs != null
  )
  return [...selected, ...(reference ? [reference] : [])].map(candidate => candidate.key)
}

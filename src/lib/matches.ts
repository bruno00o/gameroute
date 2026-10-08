import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import type {
  FlowOperator,
  MeasuredFlow,
  OperatorRoute,
  RouteZone,
  SessionMatch,
  Severity,
  SeverityThresholds,
  TraceMeasure,
  TracerouteWithHops,
} from '@/types/backend'
import { formatClock, formatElapsed, formatMs, formatPercent } from '@/lib/format'
import { shortOperatorName } from '@/lib/operators'
import { formatRouteMs, segmentAt, segmentName, zoneLabel } from '@/lib/route'

const RIOT_ASN = 6507
const MISSING = '—'
const REGION_PINGS_SHOWN = 3
const ZONES: RouteZone[] = ['home', 'isp', 'transit', 'service']

const RANK: Record<Severity, number> = {
  unmeasured: -1,
  ok: 0,
  watch: 1,
  degraded: 2,
  critical: 3,
}

const severityLabels: Record<Severity, () => string> = {
  ok: m.status_ok,
  watch: m.status_watch,
  degraded: m.status_degraded,
  critical: m.status_critical,
  unmeasured: m.status_unmeasured,
}

export function severityLabel(status: Severity): string {
  return severityLabels[status]()
}

export function severityRank(status: Severity): number {
  return RANK[status]
}

export function sessionSpan(session: { startedAt: string; endedAt: string | null }): string {
  const start = formatClock(session.startedAt)
  return session.endedAt
    ? `${start} → ${formatClock(session.endedAt)}`
    : m.session_span_ongoing({ start })
}

export function isRiot(operator: FlowOperator | null | undefined): boolean {
  return operator?.asn === RIOT_ASN || shortOperatorName(operator?.name) === 'Riot Games'
}

export function flowServerName(flow: MeasuredFlow): string {
  const operator = flow.operator
  const name =
    shortOperatorName(operator?.name) ?? (operator?.asn != null ? `AS${operator.asn}` : flow.ip)
  const city = isRiot(operator) ? null : operator?.city
  return city ? `${name} · ${city}` : name
}

export function flowServerLabel(flow: MeasuredFlow): string {
  const port = flow.port > 0 ? `${flow.protocol} ${flow.port}` : flow.protocol
  return [flowServerName(flow), port].filter(Boolean).join(' · ')
}

export function traceOf(
  flow: MeasuredFlow,
  traceroutes: TracerouteWithHops[]
): TracerouteWithHops | undefined {
  const id = flow.trace?.tracerouteId
  return id == null ? undefined : traceroutes.find(trace => trace.id === id)
}

export type PingMeasure = Pick<
  TraceMeasure,
  'pingMs' | 'atDestination' | 'measuredHop' | 'lossPct' | 'jitterMs' | 'usual'
>

export function matchMeasure(flow: MeasuredFlow): PingMeasure | null {
  const game = flow.game
  if (!game) return flow.trace
  return {
    pingMs: game.pingMs,
    atDestination: true,
    measuredHop: null,
    lossPct: game.lossPct ?? flow.trace?.lossPct ?? null,
    jitterMs: game.jitterMs ?? flow.trace?.jitterMs ?? null,
    usual: game.usual,
  }
}

export function regionPingsText(flow: MeasuredFlow, game: string): string | null {
  const pings = flow.regionPings?.pings.slice(0, REGION_PINGS_SHOWN) ?? []
  if (pings.length === 0) return null
  const list = pings
    .map(ping => `${ping.region} ${formatMs(ping.pingMs, { digits: 0 })}`)
    .join(' · ')
  return m.match_region_pings({ game, pings: list })
}

export function formatFlowPing(trace: PingMeasure | null | undefined): string {
  if (trace?.pingMs == null) return MISSING
  return formatRouteMs(trace.pingMs, !trace.atDestination)
}

export function formatLoss(loss: number | null | undefined): string {
  if (loss == null) return MISSING
  const fraction = loss > 0 && loss < 10 && Math.round(loss * 10) % 10 !== 0
  return formatPercent(loss, { digits: fraction ? 1 : 0 })
}

function operatorAt(route: OperatorRoute | null | undefined, hop: number): string | null {
  const segment = segmentAt(route, hop)
  return segment ? (segmentName(segment) ?? zoneLabel(segment.zone)) : null
}

export function measuredUpTo(
  trace: PingMeasure | null | undefined,
  route: OperatorRoute | null | undefined
): string | null {
  if (!trace || trace.atDestination || trace.measuredHop == null) return null
  const hop = String(trace.measuredHop)
  const operator = operatorAt(route, trace.measuredHop)
  return operator ? m.measured_up_to({ hop, operator }) : m.measured_up_to_hop({ hop })
}

export type TraceTiming =
  | { kind: 'during'; offsetSecs: number }
  | { kind: 'match'; number: number }
  | { kind: 'after' }
  | { kind: 'at'; time: string }

type Span = { startedAt: string; endedAt: string }

export function traceTiming(
  flow: MeasuredFlow,
  matches: SessionMatch[],
  sessionEndedAt: string | null
): TraceTiming | null {
  const trace = flow.trace
  if (!trace) return null
  const at = Date.parse(trace.startedAt)
  const covers = (span: Span) => at >= Date.parse(span.startedAt) && at <= Date.parse(span.endedAt)

  if (covers(flow)) return { kind: 'during', offsetSecs: trace.offsetSecs }
  const other = matches.find(covers)
  if (other) return { kind: 'match', number: other.number }
  if (sessionEndedAt && at > Date.parse(sessionEndedAt)) return { kind: 'after' }
  return { kind: 'at', time: trace.startedAt }
}

export function traceTimingText(timing: TraceTiming): string {
  switch (timing.kind) {
    case 'during':
      return m.trace_at({ offset: formatElapsed(timing.offsetSecs) })
    case 'match':
      return m.trace_of_match({ number: String(timing.number) })
    case 'after':
      return m.trace_after_session()
    case 'at':
      return m.trace_at_time({ time: formatClock(timing.time) })
  }
}

export function traceSource(timing: TraceTiming): string {
  switch (timing.kind) {
    case 'during':
      return m.match_source_during({ offset: formatElapsed(timing.offsetSecs) })
    case 'match':
      return m.match_source_match({ number: String(timing.number) })
    case 'after':
      return m.match_source_after()
    case 'at':
      return m.match_source_time({ time: formatClock(timing.time) })
  }
}

export function matchOfPeriod(matches: SessionMatch[], periodId: number): SessionMatch | undefined {
  return (
    matches.find(match => match.periodId === periodId) ??
    matches.find(match => match.voice?.periodId === periodId)
  )
}

const LEVELS = ['watch', 'degraded', 'critical'] as const

type ThresholdLevel = (typeof LEVELS)[number]

export function pingSourceNote(
  flow: MeasuredFlow,
  route: OperatorRoute | null | undefined
): string | null {
  return flow.game ? m.ping_by_game() : measuredUpTo(flow.trace, route)
}

export function usualPing(trace: PingMeasure | null | undefined): number | null {
  return trace?.usual?.medianMs ?? null
}

export function formatUsualPing(trace: PingMeasure): string | null {
  const usual = usualPing(trace)
  return usual == null ? null : formatRouteMs(usual, !trace.atDestination)
}

export function thresholdRules(
  thresholds: SeverityThresholds,
  usual: number | null = null
): { level: ThresholdLevel; rule: string }[] {
  return LEVELS.map(level => {
    const loss = formatLoss(thresholds[level].lossPct)
    return {
      level,
      rule:
        usual == null
          ? m.match_why_rule({ loss, ping: formatRouteMs(thresholds[level].rttMs) })
          : m.match_why_rule_usual({ loss, over: formatRouteMs(thresholds[level].overBaselineMs) }),
    }
  })
}

export function statusReason(flow: MeasuredFlow, thresholds?: SeverityThresholds | null): string {
  const trace = matchMeasure(flow)
  if (flow.status === 'unmeasured' || trace?.pingMs == null) return m.match_why_unmeasured()
  const ping = formatFlowPing(trace)
  const loss = formatLoss(trace.lossPct ?? 0)
  if (flow.status === 'ok') return m.match_why_ok({ ping, loss })
  const threshold = thresholds?.[flow.status]
  if (!threshold) return severityLabel(flow.status)
  if ((trace.lossPct ?? 0) >= threshold.lossPct) {
    return m.match_why_loss({ loss, threshold: formatLoss(threshold.lossPct) })
  }
  const usual = usualPing(trace)
  if (usual != null && trace.pingMs - usual >= threshold.overBaselineMs) {
    return m.match_why_ping_usual({
      ping,
      usual: formatUsualPing(trace)!,
      threshold: formatRouteMs(threshold.overBaselineMs),
    })
  }
  if (usual == null && trace.pingMs >= threshold.rttMs) {
    return m.match_why_ping({ ping, threshold: formatRouteMs(threshold.rttMs) })
  }
  return severityLabel(flow.status)
}

function latencyLevel(trace: PingMeasure, thresholds: SeverityThresholds): number {
  const usual = usualPing(trace)
  return usual != null && trace.pingMs != null
    ? thresholdLevel(
        trace.pingMs - usual,
        LEVELS.map(level => thresholds[level].overBaselineMs)
      )
    : thresholdLevel(
        trace.pingMs,
        LEVELS.map(level => thresholds[level].rttMs)
      )
}

export function flowProvenance(
  flow: MeasuredFlow,
  matches: SessionMatch[],
  traceroutes: TracerouteWithHops[],
  sessionEndedAt: string | null,
  { withOffset = false }: { withOffset?: boolean } = {}
): string[] {
  if (flow.game) return [m.ping_by_game()]
  if (flow.trace?.pingMs == null) return []
  const timing = traceTiming(flow, matches, sessionEndedAt)
  const upTo = measuredUpTo(flow.trace, traceOf(flow, traceroutes)?.route)
  const when = timing && (timing.kind !== 'during' || withOffset) ? traceTimingText(timing) : null
  return present([upTo, when])
}

function present(items: (string | null | undefined)[]): string[] {
  return items.filter((item): item is string => item != null)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function thresholdLevel(value: number | null | undefined, steps: number[]): number {
  if (value == null) return 0
  return steps.reduce((level, step, i) => (value >= step ? i + 1 : level), 0)
}

function listNumbers(numbers: number[]): string {
  return new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(numbers.map(String))
}

function during(matches: SessionMatch[]): string {
  const numbers = matches.map(match => match.number)
  return numbers.length === 1
    ? m.verdict_during_one({ number: String(numbers[0]) })
    : m.verdict_during_other({ numbers: listNumbers(numbers) })
}

export type VerdictZone = { status: Severity | null; name: string; note: string }

export type SessionVerdict = {
  status: Severity
  title: string
  sentences: string[]
  scope: string
  zone: RouteZone | null
  zones: Record<RouteZone, VerdictZone> | null
  reference: SessionMatch | null
}

function zoneName(zone: RouteZone, route: OperatorRoute): string {
  const names = route.segments
    .filter(segment => segment.zone === zone)
    .map(segmentName)
    .filter((name): name is string => name != null)
  if (zone === 'service' && names.length === 0) {
    const destination = shortOperatorName(route.destinationName)
    if (destination) names.push(destination)
  }
  const unique = [...new Set(names)]
  return unique.length ? `${zoneLabel(zone)} · ${unique.join(', ')}` : zoneLabel(zone)
}

function verdictZones(
  route: OperatorRoute,
  guilty: RouteZone | null,
  loss: string | null
): Record<RouteZone, VerdictZone> {
  const guiltyIndex = guilty ? ZONES.indexOf(guilty) : -1

  const zoneView = (zone: RouteZone, index: number): Omit<VerdictZone, 'name'> => {
    const segments = route.segments.filter(segment => segment.zone === zone)
    if (guilty === 'home' && zone !== 'home') {
      return { status: 'unmeasured', note: m.verdict_zone_masked() }
    }
    const status = segments.find(segment => segment.status && segment.status !== 'ok')?.status
    if (status) {
      return {
        status,
        note: loss && zone === guilty ? m.verdict_zone_loss({ loss }) : severityLabel(status),
      }
    }
    if (zone === 'service' && route.destinationSilent) {
      return { status: 'unmeasured', note: m.hop_silent() }
    }
    if (segments.length === 0) return { status: null, note: m.verdict_zone_none() }
    if (segments.every(segment => segment.firstHop > route.lastRespondingHop)) {
      return { status: 'unmeasured', note: severityLabel('unmeasured') }
    }
    if (guiltyIndex >= 0 && index > guiltyIndex) {
      return { status: null, note: m.verdict_zone_carries() }
    }
    return { status: 'ok', note: severityLabel('ok') }
  }

  return Object.fromEntries(
    ZONES.map((zone, index) => [zone, { name: zoneName(zone, route), ...zoneView(zone, index) }])
  ) as Record<RouteZone, VerdictZone>
}

function silentSentence(match: SessionMatch, route: OperatorRoute | null | undefined) {
  const trace = matchMeasure(match)
  if (!trace || trace.atDestination || trace.measuredHop == null) return null
  const hop = String(trace.measuredHop)
  const operator = operatorAt(route, trace.measuredHop)
  return operator ? m.verdict_silent({ hop, operator }) : m.verdict_silent_hop({ hop })
}

function unmeasuredSentence(count: number, ongoing: boolean) {
  if (count === 0) return null
  const params = { count: String(count) }
  if (ongoing) {
    return count === 1 ? m.verdict_some_pending_one(params) : m.verdict_some_pending_other(params)
  }
  return count === 1
    ? m.verdict_some_unmeasured_one(params)
    : m.verdict_some_unmeasured_other(params)
}

function unmeasuredTitle(matches: SessionMatch[], ongoing: boolean) {
  const number = String(matches[0].number)
  const count = String(matches.length)
  if (ongoing) {
    return matches.length === 1
      ? m.verdict_title_pending_one({ number })
      : m.verdict_title_pending_other({ count })
  }
  return matches.length === 1
    ? m.verdict_title_unmeasured_one({ number })
    : m.verdict_title_unmeasured_other({ count })
}

const onsetSentences: Record<RouteZone, (params: { hop: string }) => string> = {
  home: m.verdict_onset_home,
  isp: m.verdict_onset_isp,
  transit: m.verdict_onset_transit,
  service: m.verdict_onset_service,
}

const adviceSentences: Record<RouteZone, () => string> = {
  home: m.verdict_advice_home,
  isp: m.verdict_advice_isp,
  transit: m.verdict_advice_transit,
  service: m.verdict_advice_service,
}

function mostTraced(matches: SessionMatch[]): SessionMatch {
  const key = (match: SessionMatch) => match.trace?.tracerouteId ?? -match.periodId
  const counts = new Map<number, number>()
  for (const match of matches) {
    counts.set(key(match), (counts.get(key(match)) ?? 0) + 1)
  }
  return matches.reduce((best, match) =>
    counts.get(key(match))! > counts.get(key(best))! ? match : best
  )
}

export function sessionVerdict(
  matches: SessionMatch[],
  traceroutes: TracerouteWithHops[],
  thresholds?: SeverityThresholds | null,
  ongoing = false
): SessionVerdict | null {
  if (matches.length === 0) return null

  const measured = matches.filter(match => matchMeasure(match)?.pingMs != null)
  const scope = m.verdict_scope({
    measured: String(measured.length),
    total: String(matches.length),
  })

  if (measured.length === 0) {
    return {
      status: 'unmeasured',
      title: unmeasuredTitle(matches, ongoing),
      sentences: [ongoing ? m.verdict_pending_body() : m.verdict_unmeasured_body()],
      scope,
      zone: null,
      zones: null,
      reference: null,
    }
  }

  const worst = Math.max(...measured.map(match => RANK[match.status]))
  const unmeasured = unmeasuredSentence(matches.length - measured.length, ongoing)

  if (worst <= 0) {
    const reference = mostTraced(measured)
    const route = traceOf(reference, traceroutes)?.route
    const ping = formatRouteMs(
      median(measured.map(match => matchMeasure(match)!.pingMs!)),
      measured.some(match => !matchMeasure(match)!.atDestination)
    )
    const maxLoss = Math.max(...measured.map(match => matchMeasure(match)!.lossPct ?? 0))
    return {
      status: 'ok',
      title:
        maxLoss > 0
          ? m.verdict_title_ok_loss({ ping, loss: formatLoss(maxLoss) })
          : m.verdict_title_ok({ ping }),
      sentences: present([
        measured.length > 1 ? m.verdict_median({ count: String(measured.length) }) : null,
        silentSentence(reference, route),
        unmeasured,
      ]),
      scope,
      zone: null,
      zones: route ? verdictZones(route, null, null) : null,
      reference,
    }
  }

  const affected = measured.filter(match => RANK[match.status] === worst)
  const reference = affected[0]
  const trace = matchMeasure(reference)!
  const route = traceOf(reference, traceroutes)?.route
  const lossPct = trace.lossPct ?? 0
  const lossCause = thresholds
    ? lossPct > 0 &&
      thresholdLevel(lossPct, [
        thresholds.watch.lossPct,
        thresholds.degraded.lossPct,
        thresholds.critical.lossPct,
      ]) >= latencyLevel(trace, thresholds)
    : lossPct > 0
  const status = reference.status
  const when = during(affected)

  if (lossCause) {
    const loss = formatLoss(lossPct)
    const onset = route?.segments.find(segment => segment.status && segment.status !== 'ok')
    const zone = onset?.zone ?? null
    const name = onset ? segmentName(onset) : null
    const where =
      zone === 'home'
        ? m.verdict_where_home()
        : name
          ? m.verdict_where_operator({ operator: name })
          : null
    return {
      status,
      title: where
        ? m.verdict_title_loss({ loss, where, during: when })
        : m.verdict_title_loss_plain({ loss, during: when }),
      sentences: present([
        zone && route ? onsetSentences[zone]({ hop: String(route.lastRespondingHop) }) : null,
        zone ? adviceSentences[zone]() : null,
        unmeasured,
      ]),
      scope,
      zone,
      zones: route ? verdictZones(route, zone, loss) : null,
      reference,
    }
  }

  const largest = route?.segments.reduce<OperatorRoute['segments'][number] | null>(
    (best, segment) => (!best || segment.addedMs > best.addedMs ? segment : best),
    null
  )
  return {
    status,
    title: m.verdict_title_ping({ ping: formatFlowPing(trace), during: when }),
    sentences: present([
      largest
        ? m.verdict_ping_largest({
            operator: segmentName(largest) ?? zoneLabel(largest.zone),
            ms: formatRouteMs(largest.addedMs),
          })
        : null,
      silentSentence(reference, route),
      unmeasured,
    ]),
    scope,
    zone: null,
    zones: route ? verdictZones(route, null, null) : null,
    reference,
  }
}

import {
  isPublicIp,
  MAX_REPORT_BYTES,
  MAX_REPORT_MATCHES,
  MAX_ROUTE_HOPS,
  MAX_ROUTE_SEGMENTS,
  REPORT_GAMES,
  REPORT_SCHEMA_VERSION,
  reportPayloadSchema,
  roundToHour,
  type ReportGameSlug,
  type ReportHop,
  type ReportMatch,
  type ReportPayload,
  type ReportRoute,
  type ReportSegment,
} from '@gameroute/shared'
import * as m from '@/paraglide/messages'
import type {
  DbHop,
  OperatorRoute,
  RouteSegment,
  SessionMatch,
  SeverityThresholds,
  TracerouteWithHops,
} from '@/types/backend'
import { matchMeasure, matchReason, sessionVerdict, traceOf, usualPing } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { segmentAt } from '@/lib/route'
import type { ReportRecipient, ReportSource } from '@/lib/report'

export type ShareOptions = {
  recipient: ReportRecipient
  exactTimes: boolean
  appVersion: string
  thresholds?: SeverityThresholds | null
  route?: boolean
  hops?: boolean
}

export type ShareBlocker =
  | { kind: 'empty' }
  | { kind: 'mixed_games' }
  | { kind: 'unprofiled_game'; game: string }
  | { kind: 'too_many'; max: number }

export type ShareCheck =
  | { ok: true; payload: ReportPayload; json: string }
  | { ok: false; issues: string[] }

const NAME_MAX = 80

function clip(name: string | null | undefined): string | null {
  const trimmed = name?.trim()
  return trimmed ? trimmed.slice(0, NAME_MAX).trim() : null
}

function asnOf(asn: number | null | undefined): number | null {
  return asn != null && Number.isInteger(asn) && asn > 0 && asn <= 4_294_967_295 ? asn : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function tenth(value: number): number {
  return Math.round(value * 10) / 10
}

function ms(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : tenth(clamp(value, 0, 60_000))
}

function pct(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : tenth(clamp(value, 0, 100))
}

function hopNumber(value: number | null | undefined): number | null {
  return value != null && Number.isInteger(value) && value >= 1 && value <= 255 ? value : null
}

export function reportGameSlug(gameName: string): ReportGameSlug | null {
  const name = gameName.trim().toLowerCase()
  const entry = Object.entries(REPORT_GAMES).find(([, label]) => label.toLowerCase() === name)
  return entry ? (entry[0] as ReportGameSlug) : null
}

export function reportGameNames(): string[] {
  return Object.values(REPORT_GAMES)
}

export function shareBlocker(sources: ReportSource[]): ShareBlocker | null {
  if (sources.length === 0) return { kind: 'empty' }
  const games = new Set(sources.map(source => source.detail.gameName))
  if (games.size > 1) return { kind: 'mixed_games' }
  const [game] = games
  if (!reportGameSlug(game)) return { kind: 'unprofiled_game', game }
  if (sources.length > MAX_REPORT_MATCHES) return { kind: 'too_many', max: MAX_REPORT_MATCHES }
  return null
}

function shareVersion(version: string): string {
  return version.match(/^\d+\.\d+\.\d+/)?.[0] ?? version
}

function hopOf(hop: DbHop, route: OperatorRoute): ReportHop {
  const segment = segmentAt(route, hop.hopNumber)
  const zone = segment?.zone ?? 'home'
  const home = zone === 'home'
  const silent = hop.latencyAvg == null
  return {
    number: hop.hopNumber,
    zone,
    asn: home ? null : asnOf(segment?.asn),
    ip: !home && hop.ip != null && isPublicIp(hop.ip) ? hop.ip : null,
    silent,
    rttMs: silent ? null : ms(hop.latencyAvg),
    lossPct: silent ? null : pct(hop.packetLoss),
    status: hop.lossStatus,
  }
}

function segmentOf(segment: RouteSegment): ReportSegment {
  return {
    zone: segment.zone,
    asn: segment.zone === 'home' ? null : asnOf(segment.asn),
    name: segment.zone === 'home' ? null : clip(shortOperatorName(segment.name)),
    firstHop: segment.firstHop,
    lastHop: segment.lastHop,
    addedMs: tenth(clamp(segment.addedMs, -60_000, 60_000)),
    status: segment.status,
  }
}

function routeOf(trace: TracerouteWithHops | undefined, withHops: boolean): ReportRoute | null {
  const route = trace?.route
  if (!trace || !route || !isPublicIp(trace.targetIp)) return null
  return {
    targetIp: trace.targetIp,
    destinationAsn: asnOf(route.destinationAsn),
    destinationName: clip(shortOperatorName(route.destinationName)),
    destinationSilent: route.destinationSilent,
    lastRespondingHop: clamp(route.lastRespondingHop, 0, 255),
    totalMs: ms(route.totalMs) ?? 0,
    segments: route.segments.slice(0, MAX_ROUTE_SEGMENTS).map(segmentOf),
    hops: withHops
      ? trace.hops
          .filter(hop => hopNumber(hop.hopNumber) != null)
          .slice(0, MAX_ROUTE_HOPS)
          .map(hop => hopOf(hop, route))
      : [],
  }
}

function matchOf(source: ReportSource, options: ShareOptions): ReportMatch {
  const { match, detail } = source
  const measure = matchMeasure(match)
  const measured = measure?.pingMs != null
  const atLeast = measured && !measure.atDestination
  const startedAt = new Date(match.startedAt).toISOString()
  return {
    number: clamp(match.number, 1, 999),
    startedAt: options.exactTimes ? startedAt : roundToHour(startedAt),
    durationSecs: clamp(Math.round(match.durationSecs), 0, 86_400),
    status: match.status,
    reason: matchReason(match, options.thresholds),
    source: match.game ? 'game' : 'probe',
    pingMedianMs: measured ? ms(measure.pingMs) : null,
    pingP95Ms: null,
    pingAtLeast: atLeast,
    measuredUpToHop: atLeast ? hopNumber(measure.measuredHop) : null,
    usualPingMs: ms(usualPing(measure)),
    lossPct: measured ? pct(measure.lossPct) : null,
    jitterMs: measured ? ms(measure.jitterMs) : null,
    route:
      options.route === false
        ? null
        : routeOf(traceOf(match, detail.traceroutes), options.hops !== false),
  }
}

function ispOf(sources: ReportSource[]): ReportPayload['isp'] {
  const counts = new Map<string, { asn: number | null; name: string | null; count: number }>()
  for (const { match, detail } of sources) {
    const segment = traceOf(match, detail.traceroutes)?.route?.segments.find(
      item => item.zone === 'isp'
    )
    if (!segment) continue
    const asn = asnOf(segment.asn)
    const name = clip(shortOperatorName(segment.name))
    if (asn == null && name == null) continue
    const key = `${asn}|${name}`
    const entry = counts.get(key) ?? { asn, name, count: 0 }
    entry.count += 1
    counts.set(key, entry)
  }
  let best: { asn: number | null; name: string | null; count: number } | null = null
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry
  return best ? { asn: best.asn, name: best.name } : null
}

function verdictOf(
  sources: ReportSource[],
  thresholds: SeverityThresholds | null | undefined
): ReportPayload['verdict'] {
  const matches: SessionMatch[] = sources.map(source => source.match)
  const traceroutes = [
    ...new Map(
      sources.flatMap(source => source.detail.traceroutes).map(trace => [trace.id, trace])
    ).values(),
  ]
  const verdict = sessionVerdict(matches, traceroutes, thresholds)
  return { status: verdict?.status ?? 'unmeasured', zone: verdict?.zone ?? null }
}

export function buildSharePayload(sources: ReportSource[], options: ShareOptions): ReportPayload {
  const blocker = shareBlocker(sources)
  if (blocker) throw new Error(`Report cannot be shared: ${blocker.kind}`)
  const ordered = [...sources].sort(
    (a, b) => Date.parse(a.match.startedAt) - Date.parse(b.match.startedAt)
  )
  return {
    version: REPORT_SCHEMA_VERSION,
    appVersion: shareVersion(options.appVersion),
    gameSlug: reportGameSlug(ordered[0].detail.gameName)!,
    recipient: options.recipient,
    exactTimes: options.exactTimes,
    verdict: verdictOf(ordered, options.thresholds),
    isp: ispOf(ordered),
    matches: ordered.map(source => matchOf(source, options)),
  }
}

export function checkSharePayload(payload: unknown): ShareCheck {
  const result = reportPayloadSchema.safeParse(payload)
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`),
    }
  }
  const json = JSON.stringify(result.data)
  if (new TextEncoder().encode(json).length > MAX_REPORT_BYTES) {
    return { ok: false, issues: [`payload: larger than ${MAX_REPORT_BYTES} bytes`] }
  }
  return { ok: true, payload: result.data, json }
}

export function prepareShare(sources: ReportSource[], options: ShareOptions): ShareCheck {
  return checkSharePayload(buildSharePayload(sources, options))
}

export function sharedAddresses(payload: ReportPayload): string[] {
  const addresses = new Set<string>()
  for (const match of payload.matches) {
    for (const hop of match.route?.hops ?? []) if (hop.ip) addresses.add(hop.ip)
    if (match.route) addresses.add(match.route.targetIp)
  }
  return [...addresses]
}

export function sharedOperators(payload: ReportPayload): string[] {
  const operators = new Set<string>()
  for (const match of payload.matches) {
    for (const segment of match.route?.segments ?? []) {
      if (segment.zone === 'home') continue
      const asn = segment.asn != null ? `AS${segment.asn}` : null
      const label = segment.name && asn ? `${segment.name} (${asn})` : (segment.name ?? asn)
      if (label) operators.add(label)
    }
    const route = match.route
    if (route?.destinationName || route?.destinationAsn != null) {
      const asn = route.destinationAsn != null ? `AS${route.destinationAsn}` : null
      const name = route.destinationName
      operators.add(name && asn ? `${name} (${asn})` : (name ?? asn)!)
    }
  }
  return [...operators]
}

const errorMessages: Record<string, () => string> = {
  SHARE_OFFLINE: () => m.share_error_offline(),
  SHARE_RATE_LIMITED: () => m.share_error_rate_limited(),
  SHARE_REJECTED: () => m.share_error_rejected(),
  SHARE_TOO_LARGE: () => m.share_error_too_large(),
  SHARE_FORBIDDEN: () => m.share_error_forbidden(),
}

export function shareErrorMessage(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : null
  return (code && errorMessages[code]?.()) || m.share_error_generic()
}

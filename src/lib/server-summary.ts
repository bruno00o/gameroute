import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import type {
  IncidentCause,
  ServerIncident,
  ServerSummary,
  ServerSummaryItem,
  Severity,
} from '@/types/backend'
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

type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'

const DAY_MS = 86_400_000

const partOfDay: Record<DayPart, (params: { day: string }) => string> = {
  morning: m.home_when_morning,
  afternoon: m.home_when_afternoon,
  evening: m.home_when_evening,
  night: m.home_when_night,
}

const partOfToday: Record<DayPart, () => string> = {
  morning: m.home_today_morning,
  afternoon: m.home_today_afternoon,
  evening: m.home_today_evening,
  night: m.home_today_night,
}

function dayPart(date: Date): DayPart {
  const hour = date.getHours()
  if (hour < 6) return 'night'
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function daysBefore(date: Date, now: Date): number {
  const midnight = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate())
  return Math.round((midnight(now).getTime() - midnight(date).getTime()) / DAY_MS)
}

export function incidentWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const part = dayPart(date)
  const ago = daysBefore(date, now)
  if (ago <= 0) return partOfToday[part]()
  if (ago >= 7) return m.home_on_date({ date: formatDay(iso, { now }) })
  const day =
    ago === 1
      ? m.home_yesterday()
      : m.home_weekday({
          day: new Intl.DateTimeFormat(getLocale(), { weekday: 'long' }).format(date),
        })
  return partOfDay[part]({ day })
}

function problem(cause: IncidentCause | null, server: ServerSummaryItem, loss: number): string {
  if (cause === 'loss') return m.home_loss({ loss: formatLoss(loss) })
  if (cause === 'jitter') return m.home_problem_jitter()
  if (cause === 'latency') {
    return server.usual.medianMs == null ? m.home_problem_high() : m.home_problem_slower()
  }
  return m.home_problem_other()
}

function pingAt(ms: number, server: ServerSummaryItem): string {
  const basis = server.basis
  const ping = formatRouteMs(ms)
  if (!basis || basis.atDestination) {
    return basis?.source === 'game' ? m.home_ping_by_game({ ping }) : ping
  }
  if (basis.measuredHop == null) return m.home_ping_at_least({ ping })
  const hop = String(basis.measuredHop)
  const operator =
    basis.measuredAsn != null && basis.measuredAsn === server.asn
      ? shortOperatorName(server.operator)
      : null
  return operator
    ? m.home_ping_up_to_hop_operator({ ping, hop, operator })
    : m.home_ping_up_to_hop({ ping, hop })
}

function weekMedian(server: ServerSummaryItem): string | null {
  const recent = server.recent
  if (!recent) return null
  const values = [pingAt(recent.medianMs, server)]
  if (server.usual.medianMs != null) {
    values.push(m.home_usual({ usual: formatRouteMs(server.usual.medianMs) }))
  }
  if (recent.lossPct > 0) values.push(m.home_loss({ loss: formatLoss(recent.lossPct) }))
  return m.home_week_median({ values: values.join(', ') })
}

function rank(server: ServerSummaryItem): number {
  return server.status ? severityRank(server.status) : -1
}

function listGames(games: string[]): string {
  return new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(games)
}

function othersSentence(games: Map<string, number>, reference: string): string | null {
  const others = [...games].filter(([game]) => game !== reference)
  if (others.length === 0) return null
  const troubled = others.filter(([, worst]) => worst > 0).map(([game]) => game)
  if (troubled.length > 0) return m.home_also_watch({ games: listGames(troubled) })
  return others.length === 1
    ? m.home_others_fine_one({ game: others[0][0] })
    : m.home_others_fine_other({ count: String(others.length) })
}

export function homeVerdict(
  summary: Pick<ServerSummary, 'servers' | 'since'>,
  days: number,
  now: Date = new Date()
): HomeVerdict | null {
  const played = summary.servers.filter(server => server.status != null)
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

  const games = new Map<string, number>()
  for (const server of measured) {
    games.set(server.gameName, Math.max(games.get(server.gameName) ?? -1, rank(server)))
  }
  const unmeasured = played.length - measured.length
  const unmeasuredSentence =
    unmeasured > 0 ? counted(unmeasured, m.home_unmeasured_one, m.home_unmeasured_other) : null

  const worst = Math.max(...measured.map(rank))
  const reference = measured.find(server => rank(server) === worst)!

  if (worst <= 0) {
    const names = [...games.keys()]
    return {
      status: reference.status!,
      title:
        names.length === 1
          ? m.home_all_fine_one({ game: names[0] })
          : m.home_all_fine_other({ count: String(names.length) }),
      scope,
      sentences: unmeasuredSentence ? [unmeasuredSentence] : [],
    }
  }

  const since = Date.parse(summary.since)
  const incident =
    reference.lastIncident && Date.parse(reference.lastIncident.measuredAt) >= since
      ? reference.lastIncident
      : null
  const what = problem(
    incident?.cause ?? null,
    reference,
    incident?.lossPct ?? reference.recent!.lossPct
  )
  const when = incident ? incidentWhen(incident.measuredAt, now) : m.home_this_week()

  return {
    status: reference.status!,
    title: m.home_verdict_problem({ game: reference.gameName, problem: what, when }),
    scope,
    sentences: [
      weekMedian(reference),
      othersSentence(games, reference.gameName),
      unmeasuredSentence,
    ].filter((sentence): sentence is string => sentence != null),
  }
}

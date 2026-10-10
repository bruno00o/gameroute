import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import type {
  OperatorRoute,
  RouteChange,
  RouteOperator,
  RouteSegment,
  RouteZone,
  UsualRoute,
} from '@/types/backend'
import { formatDay, formatPercent } from '@/lib/format'
import { shortOperatorName } from '@/lib/operators'
import { formatRouteMs, segmentAt, segmentName, zoneLabel } from '@/lib/route'

export const ROUTE_DAYS = 30

type CountMessage = (params: { count: string }) => string

export function counted(count: number, one: CountMessage, other: CountMessage): string {
  const params = { count: String(count) }
  return count === 1 ? one(params) : other(params)
}

export function operatorKey(operator: { asn: number | null; name: string | null }): string | null {
  if (operator.asn != null) return `AS${operator.asn}`
  return operator.name ? operator.name.toLowerCase() : null
}

export function operatorName(operator: RouteOperator): string {
  return shortOperatorName(operator.name) ?? (operator.asn != null ? `AS${operator.asn}` : '—')
}

function operatorList(operators: RouteOperator[]): string {
  return new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(
    operators.map(operatorName)
  )
}

export function destinationName(usual: UsualRoute): string {
  return shortOperatorName(usual.route.destinationName) ?? usual.gameName
}

export function lastHopOperator(route: OperatorRoute): string {
  const segment = segmentAt(route, route.lastRespondingHop) ?? route.segments.at(-1)
  return segment ? (segmentName(segment) ?? zoneLabel(segment.zone)) : '—'
}

export function routeLimitNote(usual: UsualRoute): string | null {
  const { route } = usual
  if (!route.destinationSilent) return null
  const params = {
    destination: destinationName(usual),
    hop: String(route.lastRespondingHop),
    operator: lastHopOperator(route),
  }
  const deduced = usual.gamePing?.deducedMs
  return deduced != null
    ? m.route_limit_note_deduced({ ...params, deduced: formatRouteMs(deduced) })
    : m.route_limit_note(params)
}

export function hasSilentServer(route: OperatorRoute): boolean {
  return route.destinationSilent && route.segments.at(-1)?.zone !== 'service'
}

export function matchesOperator(segment: RouteSegment, key: string | undefined): boolean {
  return key != null && operatorKey(segment) === key
}

export type OperatorEntry = {
  key: string
  name: string
  asn: number | null
  zone: RouteZone
  gameName: string
}

export function routeOperators(routes: UsualRoute[]): OperatorEntry[] {
  const seen = new Set<string>()
  const entries: OperatorEntry[] = []
  for (const usual of routes) {
    for (const segment of usual.route.segments) {
      const key = operatorKey(segment)
      const id = `${usual.gameName}|${key}`
      if (segment.zone === 'home' || key == null || seen.has(id)) continue
      seen.add(id)
      entries.push({
        key,
        name: segmentName(segment) ?? `AS${segment.asn}`,
        asn: segment.asn,
        zone: segment.zone,
        gameName: usual.gameName,
      })
    }
  }
  return entries
}

export function changeSummary(change: RouteChange): string {
  const via = operatorList(change.via)
  const instead = operatorList(change.insteadOf)
  if (change.via.length > 0 && change.insteadOf.length > 0) {
    return m.route_change_replaced({ via, instead })
  }
  if (change.via.length > 0) return m.route_change_added({ via })
  if (change.insteadOf.length > 0) return m.route_change_missing({ instead })
  return m.route_change_reordered({ path: change.path.map(operatorName).join(' → ') })
}

export function changeFacts(change: RouteChange, usual: UsualRoute | undefined): string {
  const atLeast = usual?.route.destinationSilent ?? false
  return [
    change.traceCount > 1
      ? counted(change.traceCount, m.session_matches_count_one, m.session_matches_count_other)
      : null,
    m.route_change_total({
      total: formatRouteMs(change.totalMs, atLeast),
      usual: formatRouteMs(change.usualTotalMs, atLeast),
    }),
    change.lossPct > 0
      ? m.route_change_loss({ loss: formatPercent(change.lossPct, { digits: 1 }) })
      : m.route_change_no_loss(),
    change.returned ? m.route_change_returned() : null,
  ]
    .filter((fact): fact is string => fact != null)
    .join(' · ')
}

export function changePeriod(change: RouteChange): string {
  const start = formatDay(change.startedAt)
  const end = formatDay(change.endedAt)
  return start === end ? start : `${start} → ${end}`
}

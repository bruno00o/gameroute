import * as m from '@/paraglide/messages'
import type { DbHop, OperatorRoute, RouteSegment, RouteZone } from '@/types/backend'
import { formatMs } from '@/lib/format'
import { shortOperatorName } from '@/lib/operators'

const zoneLabels: Record<RouteZone, () => string> = {
  home: m.route_zone_home,
  isp: m.route_zone_isp,
  transit: m.route_zone_transit,
  service: m.route_zone_service,
}

export function zoneLabel(zone: RouteZone, serviceLabel?: string): string {
  return zone === 'service' && serviceLabel ? serviceLabel : zoneLabels[zone]()
}

export function segmentName(segment: RouteSegment): string | null {
  return shortOperatorName(segment.name)
}

export function segmentAt(route: OperatorRoute | null | undefined, hopNumber: number) {
  return route?.segments.find(s => hopNumber >= s.firstHop && hopNumber <= s.lastHop)
}

export function hopCount(count: number): string {
  const params = { count: String(count) }
  return count === 1 ? m.route_hop_count_one(params) : m.route_hop_count_other(params)
}

export function formatRouteMs(ms: number, atLeast = false): string {
  return formatMs(ms, { digits: Math.abs(ms) < 10 ? 1 : 0, atLeast })
}

export function lastRespondingHop(hops: DbHop[]): DbHop | undefined {
  for (let i = hops.length - 1; i >= 0; i--) {
    if (hops[i].latencyAvg != null) return hops[i]
  }
  return undefined
}

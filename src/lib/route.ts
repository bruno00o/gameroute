import * as m from '@/paraglide/messages'
import type { DbHop, OperatorRoute, ResolvedIpData, RouteSegment, RouteZone } from '@/types/backend'
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

export type RouteMapStop = {
  ip: string
  hopNumber: number | null
  latency: number | null
  operator: string | null
  silent: boolean
}

export type RouteMapPoint = { lon: number; lat: number; stops: RouteMapStop[] }

export function routeMapPoints(
  hops: DbHop[],
  targetIp: string,
  asnData: Map<string, ResolvedIpData>
): RouteMapPoint[] {
  const operator = (ip: string) => {
    const info = asnData.get(ip)?.asnInfo
    return shortOperatorName(info?.org ?? info?.isp)
  }
  const stops: RouteMapStop[] = hops.flatMap(hop =>
    hop.ip
      ? [
          {
            ip: hop.ip,
            hopNumber: hop.hopNumber,
            latency: hop.latencyAvg,
            operator: operator(hop.ip),
            silent: false,
          },
        ]
      : []
  )
  if (!stops.some(stop => stop.ip === targetIp)) {
    stops.push({
      ip: targetIp,
      hopNumber: null,
      latency: null,
      operator: operator(targetIp),
      silent: true,
    })
  }

  const points: RouteMapPoint[] = []
  for (const stop of stops) {
    const { lat, lon } = asnData.get(stop.ip)?.geo ?? {}
    if (lat == null || lon == null) continue
    const near = points.find(p => Math.abs(p.lon - lon) < 0.01 && Math.abs(p.lat - lat) < 0.01)
    if (near) near.stops.push(stop)
    else points.push({ lon, lat, stops: [stop] })
  }
  return points
}

import type { DbHop, OperatorRoute, ResolvedIpData, RouteZone } from '@/types/backend'
import { cityFromHostname } from '@/lib/hostname-city'
import { isRiot } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { segmentAt } from '@/lib/route'

const GEOIP_RELIABLE_ASNS = new Set([
  32590, 8075, 16509, 14618, 15169, 396982, 13335, 20940, 16625, 54113,
])

export type GeoPlace = {
  key: string
  name: string
  lat: number
  lon: number
  zone: RouteZone | null
  firstHop: number | null
  lastHop: number | null
  operator: string | null
}

export type GeoLink = { from: GeoPlace; to: GeoPlace; skipped: boolean }

export type RouteGeo = {
  places: GeoPlace[]
  links: GeoLink[]
  riot: boolean
  homeCountry: string | null
  located: number
  total: number
}

type Stop = { ip: string; hopNumber: number | null; zone: RouteZone | null; destination: boolean }

function asnNumber(info: ResolvedIpData | undefined): number | null {
  const value = Number(info?.asnInfo.asn?.replace(/^AS/i, ''))
  return Number.isInteger(value) && value > 0 ? value : null
}

export function routeGeo({
  hops,
  targetIp,
  route,
  asnData,
  hostnames,
}: {
  hops: DbHop[]
  targetIp: string
  route: OperatorRoute | null | undefined
  asnData: Map<string, ResolvedIpData>
  hostnames: Map<string, string | null>
}): RouteGeo {
  const stops: Stop[] = [...hops]
    .sort((a, b) => a.hopNumber - b.hopNumber)
    .flatMap(hop =>
      hop.ip
        ? [
            {
              ip: hop.ip,
              hopNumber: hop.hopNumber,
              zone:
                hop.ip === targetIp ? 'service' : (segmentAt(route, hop.hopNumber)?.zone ?? null),
              destination: hop.ip === targetIp,
            },
          ]
        : []
    )
  if (!stops.some(stop => stop.destination)) {
    stops.push({ ip: targetIp, hopNumber: null, zone: 'service', destination: true })
  }

  let riot = false
  let homeCountry: string | null = null
  let located = 0
  const places: GeoPlace[] = []

  for (const stop of stops) {
    const info = asnData.get(stop.ip)
    const segment = stop.hopNumber != null ? segmentAt(route, stop.hopNumber) : undefined
    const asn =
      asnNumber(info) ??
      (stop.destination ? (route?.destinationAsn ?? null) : (segment?.asn ?? null))
    const name =
      info?.asnInfo.org ??
      info?.asnInfo.isp ??
      (stop.destination ? (route?.destinationName ?? null) : (segment?.name ?? null))

    if (isRiot({ asn, name, city: null, country: null })) {
      riot = true
      continue
    }
    if (stop.zone === 'isp' && !homeCountry) homeCountry = info?.geo.country ?? null

    const city = cityFromHostname(hostnames.get(stop.ip))
    const geo = info?.geo
    const position = city
      ? { key: city.id, name: city.name, lat: city.lat, lon: city.lon }
      : stop.destination &&
          asn != null &&
          GEOIP_RELIABLE_ASNS.has(asn) &&
          geo?.city &&
          geo.lat != null &&
          geo.lon != null
        ? { key: `geo:${geo.lat},${geo.lon}`, name: geo.city, lat: geo.lat, lon: geo.lon }
        : null
    if (!position) continue

    located += 1
    const previous = places.at(-1)
    if (previous && previous.key === position.key && previous.zone === stop.zone) {
      previous.lastHop = stop.hopNumber ?? previous.lastHop
      continue
    }
    places.push({
      ...position,
      zone: stop.zone,
      firstHop: stop.hopNumber,
      lastHop: stop.hopNumber,
      operator: shortOperatorName(name),
    })
  }

  const links = places.slice(1).map((to, i) => {
    const from = places[i]
    const skipped = from.lastHop == null || to.firstHop == null || to.firstHop !== from.lastHop + 1
    return { from, to, skipped }
  })

  return { places, links, riot, homeCountry, located, total: stops.length }
}

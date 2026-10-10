import { describe, expect, it } from 'vitest'

import type { DbHop, OperatorRoute, ResolvedIpData, RouteSegment } from '@/types/backend'
import { routeGeo } from './route-geo'

function hop(hopNumber: number, ip: string | null): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 1,
    hopNumber,
    ip,
    hostname: null,
    latencyMin: 1,
    latencyAvg: ip ? 1 : null,
    latencyMax: 1,
    packetLoss: 0,
    isProblemHop: false,
    source: null,
    lossStatus: null,
  }
}

function segment(overrides: Partial<RouteSegment>): RouteSegment {
  return {
    zone: 'transit',
    asn: null,
    name: null,
    firstHop: 1,
    lastHop: 1,
    hops: 1,
    silentHops: 0,
    addedMs: 1,
    status: null,
    ...overrides,
  }
}

function route(overrides: Partial<OperatorRoute> = {}): OperatorRoute {
  return {
    segments: [
      segment({ zone: 'home', firstHop: 1, lastHop: 2 }),
      segment({ zone: 'isp', asn: 15557, name: 'SFR', firstHop: 3, lastHop: 5 }),
      segment({ zone: 'transit', asn: 1299, name: 'Arelion Sweden AB', firstHop: 6, lastHop: 8 }),
    ],
    lastRespondingHop: 8,
    totalMs: 20,
    destinationSilent: true,
    destinationAsn: 6507,
    destinationName: 'Riot Games, Inc',
    ...overrides,
  }
}

function resolved(
  ip: string,
  asn: number | null,
  org: string | null,
  geo: Partial<ResolvedIpData['geo']> = {}
): [string, ResolvedIpData] {
  return [
    ip,
    {
      ip,
      asnInfo: { asn: asn ? `AS${asn}` : null, isp: org, org },
      geo: { lat: null, lon: null, city: null, country: null, ...geo },
    },
  ]
}

const hops = [
  hop(1, '192.168.1.1'),
  hop(2, '10.0.10.1'),
  hop(3, '86.69.254.18'),
  hop(4, null),
  hop(5, '77.128.4.142'),
  hop(6, '62.115.118.58'),
  hop(7, '62.115.118.62'),
  hop(8, '62.115.123.12'),
]

const hostnames = new Map<string, string | null>([
  ['86.69.254.18', '18.254.69.86.rev.sfr.net'],
  ['62.115.118.58', 'prs-bb1-link.ip.twelve99.net'],
  ['62.115.118.62', 'prs-bb2-link.ip.twelve99.net'],
  ['62.115.123.12', 'ffm-bb1-link.ip.twelve99.net'],
  ['162.249.72.5', 'ffm-bb9-link.ip.twelve99.net'],
])

const asnData = new Map([
  resolved('86.69.254.18', 15557, 'SFR', { country: 'France' }),
  resolved('62.115.118.58', 1299, 'Arelion Sweden AB', { country: 'France' }),
  resolved('62.115.118.62', 1299, 'Arelion Sweden AB', {
    city: 'Boca Raton',
    lat: 26.4,
    lon: -80.1,
  }),
  resolved('162.249.72.5', 6507, 'Riot Games, Inc', {
    city: 'Amsterdam',
    lat: 52.4,
    lon: 4.9,
  }),
])

describe('routeGeo', () => {
  it('places routers from their names and never a Riot server', () => {
    const geo = routeGeo({ hops, targetIp: '162.249.72.5', route: route(), asnData, hostnames })

    expect(
      geo.places.map(place => [place.name, place.zone, place.firstHop, place.lastHop])
    ).toEqual([
      ['Paris', 'transit', 6, 7],
      ['Frankfurt', 'transit', 8, 8],
    ])
    expect(geo.places[0].operator).toBe('Arelion')
    expect(geo.links.map(link => link.skipped)).toEqual([false])
    expect(geo.riot).toBe(true)
    expect(geo.homeCountry).toBe('France')
    expect(geo.located).toBe(3)
    expect(geo.total).toBe(8)
  })

  it('recognises Riot from the route when the address is not resolved yet', () => {
    const geo = routeGeo({
      hops,
      targetIp: '162.249.72.5',
      route: route(),
      asnData: new Map(),
      hostnames,
    })
    expect(geo.riot).toBe(true)
    expect(geo.places.map(place => place.name)).toEqual(['Paris', 'Frankfurt'])
  })

  it('places a Valve relay from GeoLite with a dashed last segment', () => {
    const valve = new Map([
      ...asnData,
      resolved('155.133.248.34', 32590, 'Valve Corporation', {
        city: 'Madrid',
        lat: 40.4,
        lon: -3.7,
      }),
    ])
    const geo = routeGeo({
      hops,
      targetIp: '155.133.248.34',
      route: route({ destinationAsn: 32590, destinationName: 'Valve Corporation' }),
      asnData: valve,
      hostnames,
    })

    expect(geo.riot).toBe(false)
    expect(geo.places.at(-1)).toMatchObject({ name: 'Madrid', zone: 'service', firstHop: null })
    expect(geo.links.map(link => link.skipped)).toEqual([false, true])
  })

  it('ignores GeoLite cities for operators where it is unreliable', () => {
    const ovh = new Map([
      ...asnData,
      resolved('51.38.1.1', 16276, 'OVH SAS', { city: 'Roubaix', lat: 50.7, lon: 3.2 }),
    ])
    const geo = routeGeo({
      hops,
      targetIp: '51.38.1.1',
      route: route({ destinationAsn: 16276, destinationName: 'OVH SAS' }),
      asnData: ovh,
      hostnames,
    })
    expect(geo.places.map(place => place.name)).toEqual(['Paris', 'Frankfurt'])
    expect(geo.total).toBe(8)
  })

  it('marks a gap when unplaced hops sit between two places', () => {
    const names = new Map(hostnames)
    names.delete('62.115.118.62')
    names.set('62.115.118.58', 'bas1.paris.sfr.net')
    const geo = routeGeo({
      hops: hops.filter(h => h.hopNumber !== 7),
      targetIp: '162.249.72.5',
      route: route(),
      asnData,
      hostnames: new Map([...names, ['77.128.4.142', 'bas2.paris.sfr.net']]),
    })
    expect(geo.places.map(place => [place.name, place.zone])).toEqual([
      ['Paris', 'isp'],
      ['Paris', 'transit'],
      ['Frankfurt', 'transit'],
    ])
    expect(geo.links.map(link => link.skipped)).toEqual([false, true])
  })
})

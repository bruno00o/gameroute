import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Topology } from 'topojson-specification'
import topology from 'world-atlas/countries-110m.json'

import type { DbHop, OperatorRoute, ResolvedIpData } from '@/types/backend'
import type { GeoPlace, RouteGeo } from '@/lib/route-geo'
import { resolveAsn, resolveHostnames } from '@/lib/tauri'
import { atlasFromTopology } from '@/lib/world-atlas'
import { RouteMap, RouteMapView } from './route-map'

vi.mock('@/lib/tauri', () => ({ resolveAsn: vi.fn(), resolveHostnames: vi.fn() }))

const atlas = atlasFromTopology(topology as unknown as Topology)

function place(overrides: Partial<GeoPlace>): GeoPlace {
  return {
    key: 'paris',
    name: 'Paris',
    lat: 48.86,
    lon: 2.35,
    zone: 'transit',
    firstHop: 6,
    lastHop: 6,
    operator: 'Arelion',
    ...overrides,
  }
}

function geoOf(places: GeoPlace[], overrides: Partial<RouteGeo> = {}): RouteGeo {
  return {
    places,
    links: places
      .slice(1)
      .map((to, i) => ({ from: places[i], to, skipped: i === places.length - 2 })),
    riot: false,
    homeCountry: null,
    located: places.length,
    total: 10,
    ...overrides,
  }
}

const points = (container: HTMLElement) =>
  container.querySelectorAll('[data-slot="route-map-point"]')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RouteMapView', () => {
  it('draws one point per city and zone, with a line between cities', () => {
    const paris = place({})
    const geo = geoOf(
      [
        place({ zone: 'isp', firstHop: 3, lastHop: 5, operator: 'SFR' }),
        paris,
        place({ key: 'frankfurt', name: 'Frankfurt', lat: 50.11, lon: 8.68, firstHop: 7 }),
        place({
          key: 'geo:52.4,4.9',
          name: 'Amsterdam',
          lat: 52.4,
          lon: 4.9,
          zone: 'service',
          firstHop: null,
          lastHop: null,
          operator: 'Valve',
        }),
      ],
      { homeCountry: 'France' }
    )
    const { container } = render(<RouteMapView geo={geo} atlas={atlas} />)

    expect(points(container)).toHaveLength(4)
    for (const point of points(container)) {
      expect(Number(point.getAttribute('cx'))).toBeGreaterThan(40)
      expect(Number(point.getAttribute('cx'))).toBeLessThan(600)
      expect(Number(point.getAttribute('cy'))).toBeGreaterThan(10)
      expect(Number(point.getAttribute('cy'))).toBeLessThan(210)
    }
    expect(container.querySelectorAll('[data-slot="route-map-link"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-slot="route-map-link"][data-skipped]')).toHaveLength(1)
    expect(screen.getByRole('img')).toHaveAccessibleName('Route map: Paris, Frankfurt, Amsterdam')
    expect(screen.getByText('Your ISP')).toBeInTheDocument()
    expect(screen.getByText('Valve')).toBeInTheDocument()
    expect(screen.getByText('France, your ISP’s country')).toBeInTheDocument()
    expect(screen.getByText('Located: 4 of 10')).toBeInTheDocument()
  })

  it('names Riot in the legend without a point', () => {
    const { container } = render(
      <RouteMapView geo={geoOf([place({})], { riot: true })} atlas={atlas} />
    )
    expect(points(container)).toHaveLength(1)
    expect(screen.getByText('Riot Games, region can’t be located')).toBeInTheDocument()
    expect(screen.getByText(/Riot servers can’t be located/)).toBeInTheDocument()
  })

  it('says so when nothing can be placed', () => {
    const { container } = render(<RouteMapView geo={geoOf([], { riot: true })} atlas={atlas} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText('No point on this route can be located.')).toBeInTheDocument()
  })
})

function hop(hopNumber: number, ip: string): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 1,
    hopNumber,
    ip,
    hostname: null,
    latencyMin: 1,
    latencyAvg: 1,
    latencyMax: 1,
    packetLoss: 0,
    isProblemHop: false,
    source: null,
    lossStatus: null,
  }
}

describe('RouteMap', () => {
  it('reads router names and leaves the Riot server out', async () => {
    const riot: ResolvedIpData = {
      ip: '162.249.72.5',
      asnInfo: { asn: 'AS6507', isp: 'Riot Games, Inc', org: 'Riot Games, Inc' },
      geo: { lat: 52.4, lon: 4.9, city: 'Amsterdam', country: 'Netherlands' },
    }
    vi.mocked(resolveAsn).mockResolvedValue([riot])
    vi.mocked(resolveHostnames).mockResolvedValue([
      { ip: '62.115.118.58', hostname: 'prs-bb1-link.ip.twelve99.net' },
      { ip: '62.115.123.12', hostname: 'ffm-bb1-link.ip.twelve99.net' },
    ])
    const route: OperatorRoute = {
      segments: [],
      lastRespondingHop: 2,
      totalMs: 10,
      destinationSilent: true,
      destinationAsn: 6507,
      destinationName: 'Riot Games, Inc',
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={client}>
        <RouteMap
          hops={[hop(1, '62.115.118.58'), hop(2, '62.115.123.12')]}
          targetIp="162.249.72.5"
          route={route}
        />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('img', {}, { timeout: 5000 })).toHaveAccessibleName(
      'Route map: Paris, Frankfurt'
    )
    expect(points(container)).toHaveLength(2)
    expect(screen.getByText('Riot Games, region can’t be located')).toBeInTheDocument()
    expect(resolveHostnames).toHaveBeenCalledWith([
      '162.249.72.5',
      '62.115.118.58',
      '62.115.123.12',
    ])
  })
})

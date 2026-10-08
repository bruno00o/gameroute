import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import type {
  DbHop,
  PingBasis,
  RouteChange,
  RouteSegment,
  ServerSummary,
  ServerSummaryItem,
  UsualRoute,
} from '@/types/backend'
import { getRouteChanges, getServerSummary, getUsualRoute } from '@/lib/tauri'
import { Route as RouteScreen } from './route.index'

vi.mock('@/lib/tauri', () => ({
  getUsualRoute: vi.fn(),
  getRouteChanges: vi.fn(),
  getServerSummary: vi.fn(),
  getNetworkOverviewStats: vi.fn(),
  getRecurringProblemHops: vi.fn(),
  getServerStability: vi.fn(),
  resolveAsn: vi.fn(() => Promise.resolve([])),
  openLogDir: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/components/route/route-map', () => ({ RouteMap: () => <div data-testid="route-map" /> }))

const at = (day: number, hours: number) => new Date(2026, 8, day, hours, 0).toISOString()

const rootRoute = createRootRoute()
const routeScreen = RouteScreen.update({
  id: '/route',
  path: '/route',
  getParentRoute: () => rootRoute,
} as never)
const stub = (path: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
const routeTree = rootRoute.addChildren([
  routeScreen,
  stub('/sessions/$id/matches/$n'),
  stub('/sessions/$id'),
])

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

function hop(hopNumber: number, ip: string, latency: number): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 7,
    hopNumber,
    ip,
    hostname: null,
    latencyMin: latency,
    latencyAvg: latency,
    latencyMax: latency,
    packetLoss: 0,
    isProblemHop: false,
    source: null,
    lossStatus: null,
  }
}

function valorant(overrides: Partial<UsualRoute> = {}): UsualRoute {
  return {
    gameName: 'VALORANT',
    traceCount: 20,
    totalTraces: 23,
    persistentLoss: null,
    route: {
      segments: [
        segment({ zone: 'home', firstHop: 1, lastHop: 2, hops: 2, addedMs: 0.6 }),
        segment({
          zone: 'isp',
          asn: 15557,
          name: 'Societe Francaise Du Radiotelephone - SFR SA',
          firstHop: 3,
          lastHop: 5,
          hops: 3,
          addedMs: 3.7,
        }),
        segment({
          zone: 'transit',
          asn: 9002,
          name: 'RETN Limited',
          firstHop: 6,
          lastHop: 8,
          hops: 3,
          addedMs: 12.9,
        }),
      ],
      lastRespondingHop: 8,
      totalMs: 17.2,
      destinationSilent: true,
      destinationAsn: 6507,
      destinationName: 'Riot Games, Inc',
    },
    latest: {
      tracerouteId: 7,
      sessionId: 12,
      matchNumber: 3,
      startedAt: at(28, 21),
      targetIp: '162.249.72.5',
      hops: [hop(1, '192.168.1.254', 0.6), hop(2, '87.245.233.46', 17.2)],
    },
    ...overrides,
  }
}

function league(): UsualRoute {
  const usual = valorant()
  return {
    ...usual,
    gameName: 'League of Legends',
    traceCount: 4,
    totalTraces: 4,
    route: {
      ...usual.route,
      segments: usual.route.segments.slice(0, 2),
      lastRespondingHop: 5,
      totalMs: 4.3,
    },
  }
}

function change(overrides: Partial<RouteChange> = {}): RouteChange {
  return {
    gameName: 'VALORANT',
    startedAt: at(20, 21),
    endedAt: at(20, 21),
    sessionId: 9,
    matchNumber: 2,
    traceCount: 1,
    path: [
      { asn: 15557, name: 'SFR SA' },
      { asn: 174, name: 'Cogent Communications' },
    ],
    via: [{ asn: 174, name: 'Cogent Communications' }],
    insteadOf: [{ asn: 9002, name: 'RETN Limited' }],
    totalMs: 20.3,
    usualTotalMs: 17.2,
    lossPct: 0,
    returned: true,
    ...overrides,
  }
}

function basis(): PingBasis {
  return {
    source: 'trace',
    atDestination: false,
    measuredHop: 8,
    measuredAsn: 9002,
    serverIp: null,
  }
}

function server(overrides: Partial<ServerSummaryItem> = {}): ServerSummaryItem {
  return {
    gameName: 'VALORANT',
    asn: 6507,
    operator: 'Riot Games, Inc.',
    city: 'Paris',
    ips: ['162.249.72.5'],
    matchCount: 20,
    lastPlayedAt: at(28, 21),
    basis: basis(),
    recent: { medianMs: 17.8, lossPct: 0, sampleCount: 20 },
    usual: { medianMs: 17.2, sampleCount: 20 },
    status: 'ok',
    lastIncident: null,
    ...overrides,
  }
}

function summary(items: ServerSummaryItem[]): ServerSummary {
  return { since: at(1, 0), usualMaxSamples: 20, usualMinSamples: 5, servers: items }
}

function renderRoute(path = '/route') {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(getUsualRoute).mockResolvedValue([valorant(), league()])
  vi.mocked(getRouteChanges).mockResolvedValue([change()])
  vi.mocked(getServerSummary).mockResolvedValue(
    summary([server(), server({ gameName: 'League of Legends', city: 'Amsterdam' })])
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Route screen', () => {
  it('shows the usual route by operator with the up-to-the-last-router limit', async () => {
    renderRoute()

    const strip = await screen.findByRole('list', { name: 'Route by operator' })
    expect(within(strip).getByText('SFR')).toBeInTheDocument()
    expect(within(strip).getByText('RETN')).toBeInTheDocument()
    expect(document.querySelector('[data-slot="route-total"]')).toHaveTextContent('≥ 17 ms')
    expect(screen.getByText('Matches on this route: 20 of 23')).toBeInTheDocument()
    expect(
      screen.getByText(/Riot Games doesn.t answer pings, which is normal\. Measurement goes up to/)
    ).toHaveTextContent('(hop 8, RETN)')
  })

  it('lists what each operator adds in grey and marks the silent server as not measurable', async () => {
    renderRoute()

    const list = await screen.findByRole('list', { name: 'Added by each operator' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[2]).toHaveTextContent(`RETN`)
    expect(rows[2]).toHaveTextContent(`+13 ms`)
    expect(rows.every(row => !row.hasAttribute('data-status'))).toBe(true)
    expect(rows[3]).toHaveAttribute('data-silent', 'true')
    expect(rows[3]).toHaveTextContent('not measurable')
    expect(screen.getByText('Median over 20 matches')).toBeInTheDocument()
  })

  it('colours a segment only when its problem persists', async () => {
    const usual = valorant({ persistentLoss: 12 })
    usual.route.segments[2].status = 'degraded'
    vi.mocked(getUsualRoute).mockResolvedValue([usual])
    renderRoute()

    const list = await screen.findByRole('list', { name: 'Added by each operator' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.filter(row => row.hasAttribute('data-status'))).toEqual([rows[2]])
    expect(rows[2]).toHaveAttribute('data-status', 'degraded')
  })

  it('states each route change with its source and a link to the match', async () => {
    renderRoute()

    expect(await screen.findByText('1 change in 30 days')).toBeInTheDocument()
    expect(screen.getByText('Via Cogent instead of RETN')).toBeInTheDocument()
    expect(
      screen.getByText(
        `≥ 20 ms vs ≥ 17 ms on the usual route · no loss · Back on the usual route afterwards`
      )
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open the match' })
    expect(link).toHaveAttribute('href', '/sessions/9/matches/2')
  })

  it('says so when the route never changed', async () => {
    vi.mocked(getRouteChanges).mockResolvedValue([])
    renderRoute()

    expect(await screen.findByText('No route change')).toBeInTheDocument()
  })

  it('reads the server table without the game and without a city for Riot', async () => {
    renderRoute()

    const table = await screen.findByRole('table')
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))
    expect(within(table).getByText('Riot Games')).toBeInTheDocument()
    expect(table).not.toHaveTextContent('Paris')
    expect(table).not.toHaveTextContent('Amsterdam')
  })

  it('keeps the map behind a button', async () => {
    const user = userEvent.setup()
    renderRoute()

    expect(screen.queryByTestId('route-map')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Show map' }))
    expect(screen.getByRole('button', { name: 'Hide map' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('switches game from the header and from the address', async () => {
    const user = userEvent.setup()
    const router = renderRoute()

    await screen.findByText('Matches on this route: 20 of 23')
    await user.click(screen.getByRole('button', { name: 'League of Legends' }))

    expect(await screen.findByText('Matches on this route: 4 of 4')).toBeInTheDocument()
    expect(router.state.location.search).toEqual({ game: 'League of Legends' })
    expect(screen.getByText('No route change')).toBeInTheDocument()
  })

  it('highlights the operator asked for in the quick search', async () => {
    renderRoute('/route?game=VALORANT&operator=AS9002')

    const list = await screen.findByRole('list', { name: 'Added by each operator' })
    const current = within(list)
      .getAllByRole('listitem')
      .filter(row => row.getAttribute('aria-current') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('RETN')
  })

  it('has nothing to show before a route was traced', async () => {
    vi.mocked(getUsualRoute).mockResolvedValue([])
    renderRoute()

    expect(await screen.findByText('No route measured yet')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Route by operator' })).not.toBeInTheDocument()
  })

  it('offers a retry when the routes cannot be read', async () => {
    vi.mocked(getUsualRoute).mockRejectedValue(new Error('db'))
    renderRoute()

    expect(await screen.findByText('Couldn’t read your routes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

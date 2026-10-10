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
  GameListItem,
  PingBasis,
  ServerIncident,
  ServerSummary,
  ServerSummaryItem,
  SessionListItem,
  SessionListPage,
} from '@/types/backend'
import {
  checkCaptureServiceStatus,
  getGames,
  getServerSummary,
  getSessionList,
  getSessionMatches,
} from '@/lib/tauri'
import { sessionMatches } from '@/test/session-fixtures'
import { Route as HomeRoute } from './index'

vi.mock('@/lib/tauri', () => ({
  getServerSummary: vi.fn(),
  getSessionList: vi.fn(),
  getSessionMatches: vi.fn(),
  getGames: vi.fn(),
  checkCaptureServiceStatus: vi.fn(),
  openLogDir: vi.fn(() => Promise.resolve()),
}))

const NB = ' '
const year = new Date().getFullYear()
const at = (month: number, day: number, hours: number, minutes: number) =>
  new Date(year, month, day, hours, minutes).toISOString()

const rootRoute = createRootRoute()
const homeRoute = HomeRoute.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRoute,
} as never)
const stub = (path: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
const routeTree = rootRoute.addChildren([
  homeRoute,
  stub('/games'),
  stub('/sessions'),
  stub('/sessions/$id'),
  stub('/sessions/$id/matches/$n'),
  stub('/sessions/$id/matches/$n/recap'),
])

function basis(atDestination: boolean): PingBasis {
  return {
    source: 'trace',
    atDestination,
    measuredHop: atDestination ? null : 9,
    measuredAsn: atDestination ? null : 6507,
    serverIp: '162.249.72.5',
  }
}

function incident(overrides: Partial<ServerIncident> = {}): ServerIncident {
  return {
    sessionId: 12,
    matchNumber: 3,
    startedAt: at(9, 3, 21, 7),
    measuredAt: at(9, 4, 9, 15),
    status: 'watch',
    cause: 'latency',
    basis: basis(false),
    pingMs: 41.6,
    usual: { medianMs: 17.2, sampleCount: 20 },
    lossPct: 0,
    ...overrides,
  }
}

function server(overrides: Partial<ServerSummaryItem>): ServerSummaryItem {
  return {
    gameName: 'VALORANT',
    asn: 6507,
    operator: 'Riot Games, Inc.',
    city: 'Paris',
    ips: ['162.249.72.5'],
    matchCount: 4,
    lastPlayedAt: at(9, 6, 21, 7),
    basis: basis(false),
    recent: { medianMs: 38.2, lossPct: 0, sampleCount: 4 },
    usual: { medianMs: 17.2, sampleCount: 20 },
    status: 'watch',
    lastIncident: incident(),
    ...overrides,
  }
}

const servers: ServerSummaryItem[] = [
  server({}),
  server({
    gameName: 'League of Legends',
    city: 'Amsterdam',
    matchCount: 3,
    basis: { ...basis(true), source: 'game' },
    recent: { medianMs: 31.4, lossPct: 0, sampleCount: 3 },
    usual: { medianMs: null, sampleCount: 2 },
    status: 'ok',
    lastIncident: null,
  }),
  server({
    operator: 'OVH SAS',
    asn: 16276,
    city: 'Roubaix',
    matchCount: 2,
    basis: null,
    recent: null,
    usual: { medianMs: null, sampleCount: 0 },
    status: 'unmeasured',
    lastIncident: null,
  }),
  server({
    gameName: 'Counter-Strike 2',
    operator: 'Valve Corporation',
    asn: 32590,
    city: 'Vienna',
    matchCount: 0,
    lastPlayedAt: at(8, 20, 20, 0),
    basis: basis(true),
    recent: null,
    usual: { medianMs: 24, sampleCount: 8 },
    status: null,
    lastIncident: null,
  }),
]

function summary(items: ServerSummaryItem[]): ServerSummary {
  return { since: at(9, 1, 0, 0), recentDays: 7, usualMaxSamples: 20, usualMinSamples: 5, servers: items }
}

function session(overrides: Partial<SessionListItem>): SessionListItem {
  return {
    id: 189,
    gameName: 'VALORANT',
    startedAt: at(9, 6, 21, 7),
    endedAt: at(9, 6, 23, 45),
    endEstimated: false,
    uniqueIpCount: 12,
    tracerouteCount: 4,
    matchCount: 4,
    medianPingMs: 38.2,
    medianPingAtLeast: true,
    medianPingByGame: false,
    status: 'watch',
    ...overrides,
  }
}

function page(items: SessionListItem[], recorded = items.length): SessionListPage {
  return {
    items,
    total: recorded,
    recorded,
    firstStartedAt: items.length ? at(6, 10, 19, 27) : null,
    games: [...new Set(items.map(item => item.gameName))].map(name => ({
      name,
      sessionCount: items.filter(item => item.gameName === name).length,
    })),
  }
}

function game(name: string, monitored = true): GameListItem {
  return {
    id: name.length,
    name,
    executableName: `${name}.exe`,
    source: 'riot',
    iconUrl: null,
    monitored,
    lastPlayedAt: null,
    profile: null,
  }
}

function renderHome() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

const row = (name: RegExp) => screen.getByRole('row', { name })
const cells = (name: RegExp) => within(row(name)).getAllByRole('cell')

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(getServerSummary).mockResolvedValue(summary(servers))
  vi.mocked(getSessionList).mockResolvedValue(
    page([session({}), session({ id: 188, gameName: 'League of Legends', status: 'ok' })], 12)
  )
  vi.mocked(getGames).mockResolvedValue([])
  vi.mocked(getSessionMatches).mockReset().mockResolvedValue([])
  vi.mocked(checkCaptureServiceStatus).mockResolvedValue({ running: true, error: null })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Home', () => {
  it('opens on a verdict with the numbers of the worst server this week', async () => {
    renderHome()

    const title = await screen.findByRole('heading', { level: 2, name: /median on/ })
    expect(title.textContent).toBe(
      `≥${NB}38${NB}ms median on VALORANT, Riot Games, ≥${NB}17${NB}ms usually, no loss`
    )
    const verdict = title.closest('[data-slot=verdict]')!
    expect(verdict).toHaveAttribute('data-status', 'watch')
    expect(verdict).toHaveTextContent('Last 7 days, 9 matches, 3 game servers')
    expect(verdict).toHaveTextContent(
      'It is the only one of the 2 measured servers above a threshold.'
    )
    expect(verdict).toHaveTextContent('measured up to hop 9.')
    expect(verdict).toHaveTextContent('1 server could not be measured.')
    expect(getServerSummary).toHaveBeenCalledWith(7)
  })

  it('compares each server with its usual ping and marks a silent server with ≥', async () => {
    renderHome()

    await screen.findByRole('row', { name: /Counter-Strike 2/ })
    const header = screen.getAllByRole('columnheader').map(cell => cell.textContent)
    expect(header).toEqual(
      expect.arrayContaining(['Median ping', 'Usual', 'Loss', 'Quality', 'Last incident'])
    )

    const silent = cells(/^VALORANT.*Riot Games/)
    expect(silent[2].textContent).toBe(`≥${NB}38${NB}ms`)
    expect(silent[3].textContent).toBe(`≥${NB}17${NB}ms`)
    expect(silent[4].textContent).toBe('0%')
    expect(within(silent[5]).getByText('Watch')).toBeInTheDocument()

    const answering = cells(/League of Legends.*Riot Games/)
    expect(answering[2].textContent).toBe(`31${NB}ms`)
    expect(answering[2].firstElementChild).toHaveAttribute('title', 'measured by the game')
    expect(answering[3]).toHaveTextContent('no usual yet (2/5)')
    expect(screen.queryByText(/Paris|Amsterdam/)).not.toBeInTheDocument()
    expect(row(/OVH.*Roubaix/)).toBeInTheDocument()
  })

  it('tells a server not played this week from a match it could not measure', async () => {
    renderHome()

    await screen.findByRole('row', { name: /Counter-Strike 2/ })
    const idle = cells(/Counter-Strike 2/)
    expect(idle[1]).toHaveTextContent('0')
    expect(idle[2]).toHaveTextContent('—')
    expect(idle[3].textContent).toBe(`24${NB}ms`)
    expect(idle[5]).toHaveTextContent('No match in 7 days')
    expect(idle[5].querySelector('[data-slot=status-pill]')).not.toBeInTheDocument()

    const unmeasured = cells(/OVH/)
    expect(unmeasured[1]).toHaveTextContent('2')
    expect(unmeasured[2]).toHaveTextContent('—')
    expect(unmeasured[3]).toHaveTextContent('no usual yet (0/5)')
    expect(within(unmeasured[5]).getByText('Not measurable')).toBeInTheDocument()
  })

  it('links the last incident to its match and dates the trace it comes from', async () => {
    renderHome()

    const link = await screen.findByRole('link', { name: 'Oct 3, match 3' })
    expect(link).toHaveAttribute('href', '/sessions/12/matches/3')
    const cell = link.closest('[data-slot=server-incident]')!
    expect(within(cell as HTMLElement).getByText('Watch')).toBeInTheDocument()
    expect(cell).toHaveTextContent(
      'Ping ≥ 42 ms against ≥ 17 ms usually, from the trace on Oct 4 at 09:15'
    )
  })

  it('lists the latest sessions and leads to the full list', async () => {
    const user = userEvent.setup()
    const router = renderHome()

    const latest = await screen.findByRole('region', { name: 'Latest sessions' })
    expect(
      await within(latest).findByRole('row', { name: /League of Legends.*Good/ })
    ).toBeVisible()
    await user.click(within(latest).getByRole('button', { name: 'See all 12 sessions' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions'))
    expect(getSessionList).toHaveBeenCalledWith({}, 5, 0)
  })

  it('never shows play time', async () => {
    renderHome()

    await screen.findByRole('row', { name: /Counter-Strike 2/ })
    expect(screen.queryByText(/play time/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/total sessions/i)).not.toBeInTheDocument()
  })

  it('says so when nothing was played this week', async () => {
    vi.mocked(getServerSummary).mockResolvedValue(summary([servers[3]]))
    renderHome()

    expect(await screen.findByText('No match in the last 7 days')).toBeInTheDocument()
    expect(screen.getByText('Last match on Sep 20, in Counter-Strike 2.')).toBeInTheDocument()
    expect(document.querySelector('[data-slot=verdict]')).not.toBeInTheDocument()
  })

  it('starts a fresh install with one fact, one action and what is ready', async () => {
    vi.mocked(getServerSummary).mockResolvedValue(summary([]))
    vi.mocked(getSessionList).mockResolvedValue(page([], 0))
    vi.mocked(getGames).mockResolvedValue([
      game('League of Legends'),
      game('VALORANT'),
      game('Apex Legends', false),
    ])
    const user = userEvent.setup()
    const router = renderHome()

    expect(await screen.findByText('No match measured yet')).toBeInTheDocument()
    const items = await screen.findAllByRole('listitem')
    expect(items.map(item => item.textContent)).toEqual([
      '2 monitored games: League of Legends and VALORANT.',
      'The capture service is running.',
    ])
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(document.querySelector('[data-slot=verdict]')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'See monitored games' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/games'))
  })

  it('names the capture service when it is down on a fresh install', async () => {
    vi.mocked(getServerSummary).mockResolvedValue(summary([]))
    vi.mocked(getSessionList).mockResolvedValue(page([], 0))
    vi.mocked(checkCaptureServiceStatus).mockResolvedValue({ running: false, error: 'stopped' })
    renderHome()

    expect(await screen.findByText('The capture service is not responding.')).toBeInTheDocument()
    expect(await screen.findByText('No monitored game yet.')).toBeInTheDocument()
  })

  describe('after a match', () => {
    const MINUTE = 60_000

    function recentSession(endedMinutesAgo: number) {
      const ended = Date.now() - endedMinutesAgo * MINUTE
      const matches = sessionMatches()
      const last = matches[matches.length - 1]
      vi.mocked(getSessionList).mockResolvedValue(
        page([session({ id: 1, endedAt: new Date(ended).toISOString() })], 12)
      )
      vi.mocked(getSessionMatches).mockResolvedValue([
        ...matches.slice(0, -1),
        { ...last, endedAt: new Date(ended).toISOString() },
      ])
    }

    it('points to the summary of the match that just ended', async () => {
      recentSession(10)
      const user = userEvent.setup()
      const router = renderHome()

      expect(await screen.findByText(/Match 3 of VALORANT ended at/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'View the summary' }))

      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/sessions/1/matches/3/recap')
      )
    })

    it('says nothing once the match is old', async () => {
      recentSession(180)
      renderHome()

      await screen.findByText('Last 7 days, 9 matches, 3 game servers')
      expect(screen.queryByText(/ended at/)).not.toBeInTheDocument()
      expect(getSessionMatches).not.toHaveBeenCalled()
    })
  })
})

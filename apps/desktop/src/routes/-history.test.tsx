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
  ServerSummary,
  ServerSummaryItem,
  WeekHourCell,
  WeekHourGame,
  WeekHourGrid,
} from '@/types/backend'
import { getServerSummary, getSeverityThresholds, getWeekHourGrid } from '@/lib/tauri'
import { thresholds } from '@/test/session-fixtures'
import { Route as HistoryRoute } from './history'

vi.mock('@/lib/tauri', () => ({
  getWeekHourGrid: vi.fn(),
  getServerSummary: vi.fn(),
  getSeverityThresholds: vi.fn(),
  openLogDir: vi.fn(() => Promise.resolve()),
}))

const NB = ' '

const rootRoute = createRootRoute()
const historyRoute = HistoryRoute.update({
  id: '/history',
  path: '/history',
  getParentRoute: () => rootRoute,
} as never)
const stub = (path: string) =>
  createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
const routeTree = rootRoute.addChildren([
  historyRoute,
  stub('/sessions/$id/matches/$n'),
  stub('/sessions/$id'),
])

function cell(overrides: Partial<WeekHourCell> = {}): WeekHourCell {
  return {
    weekday: 4,
    hour: 21,
    matchCount: 6,
    sampleCount: 3,
    comparedCount: 3,
    source: 'trace',
    atLeast: true,
    medianMs: 8,
    usualMs: 5,
    overUsualMs: 3,
    lossPct: 0,
    status: 'ok',
    ...overrides,
  }
}

function valorant(cells: WeekHourCell[]): WeekHourGame {
  return {
    gameName: 'VALORANT',
    matchCount: 40,
    firstPlayedAt: '2026-07-14T12:15:00Z',
    lastPlayedAt: '2026-10-07T21:22:00Z',
    cells,
  }
}

function league(): WeekHourGame {
  return {
    gameName: 'League of Legends',
    matchCount: 12,
    firstPlayedAt: '2026-07-10T19:34:00Z',
    lastPlayedAt: '2026-10-08T17:35:00Z',
    cells: [
      cell({
        weekday: 2,
        hour: 18,
        atLeast: false,
        source: 'game',
        medianMs: 15,
        usualMs: 13,
        overUsualMs: 2,
      }),
    ],
  }
}

function grid(games: WeekHourGame[]): WeekHourGrid {
  return { since: '2026-07-10T00:00:00Z', usualMinSamples: 5, games }
}

function server(overrides: Partial<ServerSummaryItem> = {}): ServerSummaryItem {
  return {
    gameName: 'VALORANT',
    asn: 6507,
    operator: 'Riot Games, Inc.',
    city: 'Paris',
    ips: ['162.249.72.5'],
    matchCount: 20,
    lastPlayedAt: '2026-10-07T21:22:00Z',
    basis: {
      source: 'trace',
      atDestination: false,
      measuredHop: 8,
      measuredAsn: 9002,
      serverIp: null,
    },
    recent: { medianMs: 17.8, lossPct: 0, sampleCount: 20 },
    usual: { medianMs: 17.2, sampleCount: 20 },
    status: 'ok',
    lastIncident: null,
    ...overrides,
  }
}

function summary(items: ServerSummaryItem[]): ServerSummary {
  return {
    since: '2026-07-10T00:00:00Z',
    recentDays: 7,
    usualMaxSamples: 20,
    usualMinSamples: 5,
    servers: items,
  }
}

function renderHistory(path = '/history') {
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

function gridCells() {
  const table = document.querySelector('[data-slot="week-hour-grid"]')!
  return Array.from(table.querySelectorAll('tbody td'))
}

function cellAt(weekday: number, hour: number) {
  return gridCells()[weekday * 24 + hour]
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(getSeverityThresholds).mockResolvedValue(thresholds())
  vi.mocked(getWeekHourGrid).mockResolvedValue(
    grid([
      valorant([
        cell({ weekday: 4, hour: 21, overUsualMs: 3 }),
        cell({ weekday: 4, hour: 22, overUsualMs: 4 }),
        cell({ weekday: 3, hour: 20, overUsualMs: 14 }),
        cell({
          weekday: 6,
          hour: 15,
          medianMs: 44,
          usualMs: 4.3,
          overUsualMs: 39.7,
          comparedCount: 1,
          status: 'watch',
        }),
        cell({
          weekday: 1,
          hour: 9,
          medianMs: null,
          usualMs: null,
          overUsualMs: null,
          status: 'unmeasured',
          source: null,
          atLeast: false,
        }),
      ]),
      league(),
    ])
  )
  vi.mocked(getServerSummary).mockResolvedValue(
    summary([server(), server({ gameName: 'League of Legends', city: 'Amsterdam' })])
  )
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('History screen', () => {
  it('lays the cells on 7 days by 24 hours in the order the backend gives them', async () => {
    renderHistory()

    await screen.findByText(/Largest gap/)
    expect(gridCells()).toHaveLength(7 * 24)
    expect(cellAt(4, 21)).toHaveAttribute('data-tint', 'neutral')
    expect(cellAt(0, 0)).toHaveAttribute('data-tint', 'never')
  })

  it('never gives a status colour to a +3 ms gap, only a neutral tint', async () => {
    renderHistory()

    await screen.findByText(/Largest gap/)
    const small = cellAt(4, 21)
    expect(small).toHaveAttribute('data-tint', 'neutral')
    expect(small).toHaveAttribute('data-level', '0')
    expect(small).not.toHaveAttribute('data-status')
    expect(small.className).not.toMatch(/watch|degraded|critical/)
    expect(cellAt(3, 20)).toHaveAttribute('data-level', '2')
  })

  it('colours only the cell beyond the threshold and writes its gap as a lower bound', async () => {
    renderHistory()

    await screen.findByText(/Largest gap/)
    const watch = cellAt(6, 15)
    expect(watch).toHaveAttribute('data-tint', 'status')
    expect(watch).toHaveAttribute('data-status', 'watch')
    expect(watch).toHaveTextContent('≥+40')
    expect(watch).toHaveAttribute('title', expect.stringContaining('Watch'))
    expect(gridCells().filter(td => td.hasAttribute('data-status'))).toEqual([watch])
  })

  it('flags lower bounds in the cell description and explains the sign', async () => {
    renderHistory()

    await screen.findByText(/Largest gap/)
    expect(cellAt(4, 21)).toHaveAttribute('title', expect.stringContaining(`gap ≥${NB}+3.0${NB}ms`))
    expect(
      screen.getByText('≥: ping measured up to the last router that answers, not up to the server.')
    ).toBeInTheDocument()
  })

  it('states the widest gap and the threshold in the title', async () => {
    renderHistory()

    expect(
      await screen.findByText(
        `Largest gap: ≥ +40 ms on Sunday at 15:00, over 1 measure. 1 cell beyond a threshold (+20 ms or loss).`
      )
    ).toBeInTheDocument()
  })

  it('grades the legend in ms from the watch threshold', async () => {
    renderHistory()

    await screen.findByText(/Largest gap/)
    const legend = screen.getByRole('list', { name: 'Legend' })
    const items = within(legend).getAllByRole('listitem')
    expect(items.map(item => item.textContent)).toEqual([
      'under +5 ms',
      '+5 to +10 ms',
      '+10 to +15 ms',
      '+15 to +20 ms',
      'Watch from +20 ms',
      'No comparison',
      'No match at this hour',
    ])
  })

  it('ramps each class of gap to its own step, up to the status colour', async () => {
    renderHistory()

    await screen.findByText(/Largest gap/)
    const legend = screen.getByRole('list', { name: 'Legend' })
    const swatches = within(legend)
      .getAllByRole('listitem')
      .slice(0, 5)
      .map(item => item.querySelector('[aria-hidden]')!.className)
    expect(swatches.map(name => name.match(/bg-heat-\w+/)?.[0])).toEqual([
      'bg-heat-0',
      'bg-heat-1',
      'bg-heat-2',
      'bg-heat-3',
      'bg-heat-watch',
    ])
    expect(cellAt(4, 21)).toHaveClass('bg-heat-0')
    expect(cellAt(3, 20)).toHaveClass('bg-heat-2')
    expect(cellAt(6, 15)).toHaveClass('bg-heat-watch')
  })

  it('hatches the hours that were never played and dashes the ones without comparison', async () => {
    renderHistory()

    await screen.findByText(/Largest gap/)
    expect(cellAt(1, 9)).toHaveAttribute('data-tint', 'unknown')
    expect(cellAt(1, 9)).toHaveAttribute('title', expect.stringContaining('no ping measured'))
    expect(cellAt(2, 3)).toHaveAttribute('data-tint', 'never')
    expect(cellAt(2, 3)).toHaveAttribute('title', 'Wednesday 3:00, no match')
  })

  it('switches game and keeps a game-measured ping free of the lower-bound flag', async () => {
    const user = userEvent.setup()
    const router = renderHistory()

    await screen.findByText(/Largest gap/)
    const picker = screen.getByRole('combobox', { name: 'Game' })
    expect(picker).toHaveTextContent('VALORANT')
    await user.click(picker)
    const options = await screen.findAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'VALORANT4040 matches',
      'League of Legends1212 matches',
    ])
    await user.click(options[1])

    await waitFor(() => expect(router.state.location.search).toEqual({ game: 'League of Legends' }))
    await screen.findByText(
      `Largest gap: +2.0 ms on Wednesday at 18:00, over 3 measures. No cell beyond a threshold (+20 ms or loss).`
    )
    expect(cellAt(2, 18)).toHaveAttribute('title', expect.stringContaining('measured by the game'))
    expect(screen.queryByText(/ping measured up to the last router/)).not.toBeInTheDocument()
    expect(
      screen.getByText(/When the game measures its own ping, that one is used/)
    ).toBeInTheDocument()
  })

  it('asks the backend for the chosen period and reads the server table for the game', async () => {
    const user = userEvent.setup()
    renderHistory()

    await screen.findByText(/Largest gap/)
    expect(getWeekHourGrid).toHaveBeenCalledWith(90)
    expect(getServerSummary).toHaveBeenCalledWith(90)
    const table = await waitFor(() => {
      const found = screen
        .getAllByRole('table')
        .find(item => !item.matches('[data-slot="week-hour-grid"]'))
      expect(found).toBeDefined()
      return found!
    })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))
    expect(within(table).getByText('Riot Games')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '1 year' }))
    await waitFor(() => expect(getWeekHourGrid).toHaveBeenCalledWith(365))
  })

  it('says so when no match was played in the period', async () => {
    vi.mocked(getWeekHourGrid).mockResolvedValue(grid([]))
    renderHistory('/history?days=30')

    expect(await screen.findByText('No match in the last 30 days')).toBeInTheDocument()
    expect(getWeekHourGrid).toHaveBeenCalledWith(30)
    expect(document.querySelector('[data-slot="week-hour-grid"]')).toBeNull()
  })

  it('explains the missing usual instead of inventing a gap', async () => {
    vi.mocked(getWeekHourGrid).mockResolvedValue(
      grid([valorant([cell({ comparedCount: 0, usualMs: null, overUsualMs: null, medianMs: 8 })])])
    )
    renderHistory()

    expect(
      await screen.findByText(
        'No gap to show yet: a usual ping needs 5 earlier measures at the same point.'
      )
    ).toBeInTheDocument()
    expect(cellAt(4, 21)).toHaveAttribute('data-tint', 'unknown')
  })

  it('offers a retry when the history cannot be read', async () => {
    vi.mocked(getWeekHourGrid).mockRejectedValue(new Error('boom'))
    renderHistory()

    expect(await screen.findByText('Could not read your history.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

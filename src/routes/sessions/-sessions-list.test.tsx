import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { SessionListItem, SessionListPage } from '@/types/backend'
import { getSessionList } from '@/lib/tauri'
import { Route } from './index'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

vi.mock('@/lib/tauri', () => ({
  getSessionList: vi.fn(),
  openLogDir: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/export-csv', () => ({ exportSessionsList: vi.fn() }))

const NB = ' '
const listSessions = vi.mocked(getSessionList)
const year = new Date().getFullYear()

function session(overrides: Partial<SessionListItem>): SessionListItem {
  return {
    id: 1,
    gameName: 'VALORANT',
    startedAt: new Date(year, 9, 3, 21, 7).toISOString(),
    endedAt: new Date(year, 9, 3, 23, 45).toISOString(),
    endEstimated: false,
    uniqueIpCount: 12,
    tracerouteCount: 4,
    matchCount: 4,
    medianPingMs: 17.6,
    medianPingAtLeast: true,
    medianPingByGame: false,
    status: 'watch',
    ...overrides,
  }
}

const rows: SessionListItem[] = [
  session({ id: 189 }),
  session({
    id: 188,
    gameName: 'League of Legends',
    matchCount: 3,
    medianPingMs: 31.2,
    medianPingByGame: true,
    medianPingAtLeast: false,
    status: 'ok',
  }),
  session({
    id: 182,
    endEstimated: true,
    matchCount: 22,
    medianPingMs: null,
    medianPingAtLeast: false,
    status: 'unmeasured',
  }),
  session({ id: 183, matchCount: 0, medianPingMs: null, medianPingAtLeast: false, status: null }),
]

function page(items: SessionListItem[], overrides: Partial<SessionListPage> = {}): SessionListPage {
  return {
    items,
    total: items.length,
    recorded: 65,
    firstStartedAt: new Date(year, 6, 10, 19, 27).toISOString(),
    games: [
      { name: 'League of Legends', sessionCount: 21 },
      { name: 'VALORANT', sessionCount: 44 },
    ],
    ...overrides,
  }
}

function renderPage() {
  const SessionsPage = Route.options.component!
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionsPage />
    </QueryClientProvider>
  )
}

const row = (name: RegExp) => screen.getByRole('row', { name })
const cells = (name: RegExp) => within(row(name)).getAllByRole('cell')
const lastFilter = () => listSessions.mock.lastCall?.[0]

beforeEach(() => {
  listSessions.mockReset()
  navigate.mockReset()
})

afterEach(cleanup)

describe('Sessions list', () => {
  it('shows one row per session with matches, median ping and quality', async () => {
    listSessions.mockResolvedValue(page(rows))
    renderPage()

    expect(await screen.findByRole('row', { name: /League of Legends/ })).toBeInTheDocument()
    expect(screen.getByText('65 sessions since Jul 10')).toBeInTheDocument()
    expect(listSessions).toHaveBeenCalledWith({ toReview: false }, 20, 0)

    const valorant = cells(/^VALORANT.*Watch/)
    expect(valorant[3]).toHaveTextContent('4')
    expect(valorant[4].textContent).toBe(`≥${NB}18${NB}ms`)
    expect(within(valorant[5]).getByText('Watch')).toBeInTheDocument()
    expect(valorant[5].querySelector('[data-slot=severity-glyph]')).toBeInTheDocument()

    const league = cells(/League of Legends/)
    expect(league[4].textContent).toBe(`31${NB}ms`)
    expect(league[4]).not.toHaveTextContent('≥')
    expect(league[4].firstElementChild).toHaveAttribute('title', 'measured by the game')
    expect(valorant[4].firstElementChild).toHaveAttribute(
      'title',
      'up to the last responding router'
    )
    expect(within(league[5]).getByText('Good')).toBeInTheDocument()
  })

  it('never shows zero for a session it could not measure', async () => {
    listSessions.mockResolvedValue(page(rows))
    renderPage()

    await screen.findByRole('row', { name: /Not measurable/ })
    const unmeasured = cells(/Not measurable/)
    expect(unmeasured[3]).toHaveTextContent('22')
    expect(unmeasured[4]).toHaveTextContent('—')
    expect(within(unmeasured[5]).getByText('Not measurable')).toBeInTheDocument()

    const noMatch = screen
      .getAllByRole('row')
      .find(
        r => r.textContent?.startsWith('VALORANT') && within(r).queryAllByText('—').length === 2
      )!
    const noMatchCells = within(noMatch).getAllByRole('cell')
    expect(noMatchCells[3]).toHaveTextContent('0')
    expect(noMatchCells[5]).toHaveTextContent('—')
    expect(noMatchCells[5].querySelector('[data-slot=status-pill]')).not.toBeInTheDocument()
  })

  it('marks an estimated end and explains it once', async () => {
    listSessions.mockResolvedValue(page(rows))
    renderPage()

    await screen.findByRole('row', { name: /estimated/ })
    const estimated = cells(/estimated/)
    expect(estimated[2]).toHaveTextContent(/^≈/)
    expect(screen.getByText(/Estimated end: the session stayed open/)).toBeInTheDocument()
  })

  it('opens a session from its row', async () => {
    listSessions.mockResolvedValue(page(rows))
    renderPage()

    await userEvent.click(await screen.findByText('League of Legends', { selector: 'td span' }))

    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$id',
      params: { id: '188' },
      search: { period: undefined },
    })
  })

  it('shows placeholder rows while the local database is read', () => {
    listSessions.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('points to the monitored games before the first session', async () => {
    listSessions.mockResolvedValue(page([], { recorded: 0, firstStartedAt: null, games: [] }))
    renderPage()

    expect(await screen.findByText('No sessions yet')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'See monitored games' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/games' })
  })

  it('searches after a pause and offers to clear a search without result', async () => {
    listSessions.mockResolvedValue(page(rows))
    renderPage()
    await screen.findByRole('row', { name: /League of Legends/ })

    listSessions.mockResolvedValue(page([]))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search sessions' }), 'ranked')

    expect(await screen.findByText('No sessions for “ranked”')).toBeInTheDocument()
    expect(lastFilter()).toEqual({ search: 'ranked', toReview: false })
    expect(screen.getByText(/Search for a game \(VALORANT\) or a server/)).toBeInTheDocument()

    listSessions.mockResolvedValue(page(rows))
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(await screen.findByRole('row', { name: /League of Legends/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search sessions' })).toHaveValue('')
    expect(lastFilter()).toEqual({ toReview: false })
  })

  it('filters by game and keeps only the sessions to review', async () => {
    listSessions.mockResolvedValue(page(rows))
    renderPage()
    await screen.findByRole('row', { name: /League of Legends/ })

    const picker = screen.getByRole('combobox', { name: 'Game' })
    expect(picker).toHaveTextContent('Game:All')
    await userEvent.click(picker)
    const options = await screen.findAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      'All games6565 sessions',
      'VALORANT4444 sessions',
      'League of Legends2121 sessions',
    ])
    await userEvent.click(options[2])
    await waitFor(() =>
      expect(lastFilter()).toEqual({ game: 'League of Legends', toReview: false })
    )
    expect(picker).toHaveTextContent('Game:League of Legends')

    listSessions.mockResolvedValue(page([]))
    await userEvent.click(screen.getByRole('button', { name: 'To review' }))
    await waitFor(() => expect(lastFilter()).toEqual({ game: 'League of Legends', toReview: true }))

    expect(await screen.findByText('No sessions to review')).toBeInTheDocument()
    expect(screen.getByText('No measured match went past a threshold.')).toBeInTheDocument()

    listSessions.mockResolvedValue(page(rows))
    await userEvent.click(screen.getByRole('button', { name: 'Show all sessions' }))
    await waitFor(() => expect(lastFilter()).toEqual({ toReview: false }))
  })

  it('says the sessions could not be read and retries on demand', async () => {
    listSessions.mockRejectedValue({ code: 'INTERNAL_ERROR', message: 'database is locked' })
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t read your sessions.')
    expect(alert).toHaveTextContent(/open the logs and attach them/)

    listSessions.mockResolvedValue(page(rows))
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('row', { name: /League of Legends/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

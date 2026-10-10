import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { GameListItem, GameProfile, ServerSummaryItem } from '@/types/backend'
import {
  addManualGame,
  getGameCount,
  getGames,
  getMonitoredGameCount,
  getServerSummary,
  removeGame,
  scanAllGames,
  searchGameCount,
  searchGames,
  toggleGameMonitored,
} from '@/lib/tauri'
import { Route } from './games'

vi.mock('@/lib/tauri', () => ({
  addManualGame: vi.fn(),
  getGameCount: vi.fn(),
  getGames: vi.fn(),
  getMonitoredGameCount: vi.fn(),
  getServerSummary: vi.fn(),
  removeGame: vi.fn(),
  scanAllGames: vi.fn(),
  scanEpicGames: vi.fn(),
  scanRiotGames: vi.fn(),
  scanSteamGames: vi.fn(),
  searchGameCount: vi.fn(),
  searchGames: vi.fn(),
  toggleGameMonitored: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const NB = ' '

const riotProfile: GameProfile = {
  operator: 'Riot Games',
  asn: 6507,
  udpPorts: [7000, 7999],
  voiceSeparate: true,
  relay: false,
}

function game(overrides: Partial<GameListItem>): GameListItem {
  return {
    id: 1,
    name: 'VALORANT',
    executableName: 'VALORANT-Win64-Shipping.exe',
    source: 'riot',
    iconUrl: null,
    monitored: true,
    lastPlayedAt: null,
    profile: riotProfile,
    ...overrides,
  }
}

function server(overrides: Partial<ServerSummaryItem>): ServerSummaryItem {
  return {
    gameName: 'VALORANT',
    asn: 6507,
    operator: 'Riot Games, Inc',
    city: null,
    ips: ['162.249.72.5'],
    matchCount: 4,
    lastPlayedAt: new Date(2026, 9, 4, 21, 0).toISOString(),
    basis: {
      source: 'trace',
      atDestination: false,
      measuredHop: 9,
      measuredAsn: 6507,
      serverIp: '162.249.72.5',
    },
    recent: { medianMs: 17.4, lossPct: 0, sampleCount: 4 },
    usual: { medianMs: 12.2, sampleCount: 18 },
    status: 'watch',
    lastIncident: null,
    ...overrides,
  }
}

const library: GameListItem[] = [
  game({ id: 1 }),
  game({
    id: 2,
    name: 'League of Legends',
    executableName: 'League of Legends.exe',
    profile: { ...riotProfile, voiceSeparate: false },
  }),
  game({
    id: 3,
    name: 'Counter-Strike 2',
    executableName: 'cs2.exe',
    source: 'steam',
    profile: { operator: 'Valve', asn: null, udpPorts: null, voiceSeparate: false, relay: true },
  }),
  game({
    id: 4,
    name: 'Rocket League',
    executableName: 'RocketLeague.exe',
    source: 'epic',
    monitored: false,
    profile: null,
  }),
  game({
    id: 5,
    name: 'Deadlock',
    executableName: 'deadlock.exe',
    source: 'manual',
    profile: null,
  }),
]

const servers: ServerSummaryItem[] = [
  server({}),
  server({
    gameName: 'League of Legends',
    basis: {
      source: 'trace',
      atDestination: true,
      measuredHop: 12,
      measuredAsn: 6507,
      serverIp: '104.160.141.3',
    },
    recent: { medianMs: 31.2, lossPct: 0, sampleCount: 3 },
    usual: { medianMs: null, sampleCount: 2 },
    status: 'ok',
  }),
  server({
    gameName: 'Counter-Strike 2',
    recent: null,
    usual: { medianMs: null, sampleCount: 0 },
    status: null,
  }),
]

const getGamesMock = vi.mocked(getGames)

function mockLibrary(items = library, summary: ServerSummaryItem[] = servers) {
  getGamesMock.mockResolvedValue(items)
  vi.mocked(getGameCount).mockResolvedValue(items.length)
  vi.mocked(getMonitoredGameCount).mockResolvedValue(items.filter(g => g.monitored).length)
  vi.mocked(getServerSummary).mockResolvedValue({
    since: new Date(2026, 9, 1).toISOString(),
    recentDays: 7,
    usualMaxSamples: 20,
    usualMinSamples: 5,
    servers: summary,
  })
}

function renderPage() {
  const GamesPage = Route.options.component!
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <GamesPage />
    </QueryClientProvider>
  )
}

const row = (name: RegExp) => screen.getByRole('row', { name })
const cells = (name: RegExp) => within(row(name)).getAllByRole('cell')

beforeEach(() => {
  vi.mocked(addManualGame).mockReset()
  vi.mocked(removeGame).mockReset()
  vi.mocked(toggleGameMonitored).mockReset()
  vi.mocked(scanAllGames).mockReset()
  vi.mocked(searchGames).mockReset()
  vi.mocked(searchGameCount).mockReset()
  mockLibrary()
})

afterEach(cleanup)

describe('Games', () => {
  it('lists the library and counts what is monitored', async () => {
    renderPage()

    expect(await screen.findByRole('row', { name: /VALORANT/ })).toBeInTheDocument()
    expect(await screen.findByText('Games: 5 · Monitored: 4')).toBeInTheDocument()
    expect(within(row(/VALORANT/)).getByText('VALORANT-Win64-Shipping.exe')).toBeInTheDocument()
    expect(getGamesMock).toHaveBeenCalledWith(20, 0)
  })

  it('names the launcher instead of the raw source', async () => {
    renderPage()
    await screen.findByRole('row', { name: /VALORANT/ })

    expect(cells(/VALORANT/)[1]).toHaveTextContent('Riot')
    expect(cells(/VALORANT/)[1]).not.toHaveTextContent('riot')
    expect(cells(/Counter-Strike 2/)[1]).toHaveTextContent('Steam')
    expect(cells(/Rocket League/)[1]).toHaveTextContent('Epic')
    expect(cells(/Deadlock/)[1]).toHaveTextContent('Manual')
  })

  it('describes the network profile of each game', async () => {
    renderPage()
    await screen.findByRole('row', { name: /VALORANT/ })

    expect(cells(/VALORANT/)[2]).toHaveTextContent('Riot Games · AS6507')
    expect(cells(/VALORANT/)[2]).toHaveTextContent('game UDP 7000–7999 · voice separate')
    expect(cells(/League of Legends/)[2]).toHaveTextContent('game UDP 7000–7999')
    expect(cells(/League of Legends/)[2]).not.toHaveTextContent('voice')
    expect(cells(/Counter-Strike 2/)[2]).toHaveTextContent('Valve · relay')
    expect(cells(/Counter-Strike 2/)[2]).toHaveTextContent('the relay hides the match server')
    expect(cells(/Rocket League/)[2]).toHaveTextContent('No profile')
    expect(cells(/Rocket League/)[2]).toHaveTextContent('longest UDP flow')
  })

  it('shows the recent ping against the usual one, with a lower bound when it is not at the server', async () => {
    renderPage()

    await waitFor(() => expect(cells(/VALORANT/)[3]).toHaveTextContent('Watch'))
    const valorant = cells(/VALORANT/)[3]
    expect(valorant).toHaveTextContent(`≥${NB}17${NB}ms`)
    expect(valorant).toHaveTextContent(`usually ≥${NB}12${NB}ms`)
    expect(valorant.querySelector('[data-slot=status-pill]')).toBeInTheDocument()
  })

  it('does not invent a usual ping before there are enough measures', async () => {
    renderPage()

    await waitFor(() => expect(cells(/League of Legends/)[3]).toHaveTextContent('Good'))
    const league = cells(/League of Legends/)[3]
    expect(league).toHaveTextContent(`31${NB}ms`)
    expect(league).not.toHaveTextContent('≥')
    expect(league).toHaveTextContent('no usual ping yet')
    expect(league).not.toHaveTextContent('usually')
  })

  it('says nothing about a game without measures, and when a server was not played lately', async () => {
    renderPage()

    await waitFor(() => expect(cells(/Counter-Strike 2/)[3]).toHaveTextContent('No match'))
    expect(cells(/Counter-Strike 2/)[3]).toHaveTextContent('No match in the last 7 days')
    expect(cells(/Rocket League/)[3]).toHaveTextContent('—')
    expect(cells(/Rocket League/)[3].querySelector('[data-slot=status-pill]')).toBeNull()
  })

  it('mentions the last incident and the number of servers', async () => {
    mockLibrary(library, [
      ...servers,
      server({
        ips: ['162.249.73.9'],
        lastPlayedAt: new Date(2026, 9, 2, 20, 0).toISOString(),
        lastIncident: {
          sessionId: 8,
          matchNumber: 2,
          startedAt: new Date(2026, 9, 2, 20, 0).toISOString(),
          measuredAt: new Date(2026, 9, 2, 20, 30).toISOString(),
          status: 'degraded',
          cause: 'loss',
          basis: {
            source: 'trace',
            atDestination: false,
            measuredHop: 9,
            measuredAsn: 6507,
            serverIp: '162.249.73.9',
          },
          pingMs: 40,
          usual: { medianMs: 12, sampleCount: 18 },
          lossPct: 3,
        },
      }),
    ])
    renderPage()

    await waitFor(() => expect(cells(/VALORANT/)[3]).toHaveTextContent('2 servers'))
    expect(cells(/VALORANT/)[3]).toHaveTextContent(/Last incident .*2/)
    expect(cells(/VALORANT/)[3]).toHaveTextContent(`≥${NB}17${NB}ms`)
  })

  it('shows no player stats', async () => {
    renderPage()
    await screen.findByRole('row', { name: /VALORANT/ })

    const headers = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(headers).toEqual(
      expect.arrayContaining(['Game', 'Launcher', 'Network profile', 'Network', 'Monitoring'])
    )
    expect(headers.join(' ')).not.toMatch(/play time|sessions|last played/i)
  })

  it('turns monitoring off and on from the switch', async () => {
    vi.mocked(toggleGameMonitored).mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('row', { name: /VALORANT/ })

    const user = userEvent.setup()
    const toggle = within(row(/VALORANT/)).getByRole('switch', { name: 'Monitor VALORANT' })
    expect(toggle).toBeChecked()
    expect(row(/VALORANT/)).toHaveTextContent('Monitored')

    await user.click(toggle)
    expect(toggleGameMonitored).toHaveBeenCalledWith(1, false)

    const ignored = within(row(/Rocket League/)).getByRole('switch', {
      name: 'Monitor Rocket League',
    })
    expect(row(/Rocket League/)).toHaveTextContent('Ignored')
    await user.click(ignored)
    expect(toggleGameMonitored).toHaveBeenCalledWith(4, true)
  })

  it('adds a game by hand', async () => {
    vi.mocked(addManualGame).mockResolvedValue(6)
    renderPage()
    await screen.findByRole('row', { name: /VALORANT/ })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add a game' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByPlaceholderText('e.g. Deadlock')).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('C:\\…\\game.exe')).toBeInTheDocument()

    await user.type(within(dialog).getByLabelText('Game name'), 'Overwatch')
    await user.type(within(dialog).getByLabelText('Executable'), 'C:\\Games\\Overwatch.exe')
    await user.click(within(dialog).getByRole('button', { name: 'Add the game' }))

    await waitFor(() =>
      expect(addManualGame).toHaveBeenCalledWith('Overwatch', 'C:\\Games\\Overwatch.exe')
    )
  })

  it('removes a game after confirmation', async () => {
    vi.mocked(removeGame).mockResolvedValue(undefined)
    renderPage()
    await screen.findByRole('row', { name: /Rocket League/ })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete game Rocket League' }))
    expect(removeGame).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(removeGame).toHaveBeenCalledWith(4))
  })

  it('waits before searching and goes back to the first page', async () => {
    vi.mocked(searchGames).mockResolvedValue([library[0]])
    vi.mocked(searchGameCount).mockResolvedValue(1)
    renderPage()
    await screen.findByRole('row', { name: /VALORANT/ })

    const user = userEvent.setup()
    const field = screen.getByRole('textbox', { name: 'Search games' })
    expect(field).toHaveAttribute('placeholder', 'Search a game or an executable…')

    await user.type(field, 'val')
    expect(searchGames).not.toHaveBeenCalled()

    await waitFor(() => expect(searchGames).toHaveBeenCalledWith('val', 20, 0))
    expect(searchGames).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('row', { name: /Deadlock/ })).toBeNull())
  })

  it('suggests a scan when the library is empty', async () => {
    mockLibrary([], [])
    vi.mocked(scanAllGames).mockResolvedValue({ gamesFound: 2, gamesAdded: 2, gamesUpdated: 0 })
    renderPage()

    expect(await screen.findByText('No games in the library.')).toBeInTheDocument()
    const empty = document.querySelector('[data-slot=empty-state]') as HTMLElement
    const user = userEvent.setup()
    await user.click(within(empty).getByRole('button', { name: 'Scan Riot, Steam and Epic' }))
    expect(scanAllGames).toHaveBeenCalledTimes(1)
  })

  it('explains what the network profile is for', async () => {
    renderPage()
    await screen.findByRole('row', { name: /VALORANT/ })

    expect(
      screen.getByText('The network profile tells GameRoute which server to aim at.')
    ).toBeInTheDocument()
  })
})

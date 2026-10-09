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

import type { GameListItem } from '@/types/backend'
import {
  checkCaptureServiceStatus,
  getAppSettings,
  getGames,
  restartCaptureService,
  scanAllGames,
  toggleGameMonitored,
} from '@/lib/tauri'
import { useSettingsStore } from '@/stores/settings-store'
import { Route as WelcomeRoute } from './welcome'
import { Route as SettingsRoute } from './settings.index'

vi.mock('@/lib/tauri', () => ({
  checkCaptureServiceStatus: vi.fn(),
  restartCaptureService: vi.fn(),
  getGames: vi.fn(),
  scanAllGames: vi.fn(),
  toggleGameMonitored: vi.fn(),
  addManualGame: vi.fn(),
  getAppSettings: vi.fn(),
  setMinimizeToTray: vi.fn(),
  openLogDir: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: () => Promise.resolve(false),
  enable: vi.fn(),
  disable: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('0.1.18') }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))

const messages = import.meta.glob<Record<string, string>>('../../messages/*.json', {
  eager: true,
  import: 'default',
})

function game(id: number, name: string, source: string, monitored = true): GameListItem {
  return {
    id,
    name,
    executableName: `${name}.exe`,
    source,
    iconUrl: null,
    monitored,
    lastPlayedAt: null,
    profile: null,
  }
}

const GAMES = [
  game(1, 'League of Legends', 'riot'),
  game(2, 'Counter-Strike 2', 'steam'),
  game(3, 'Rocket League', 'epic', false),
]

function renderFlow(initialPath = '/welcome') {
  const rootRoute = createRootRoute()
  const welcomeRoute = WelcomeRoute.update({
    id: '/welcome',
    path: '/welcome',
    getParentRoute: () => rootRoute,
  } as never)
  const settingsRoute = SettingsRoute.update({
    id: '/settings',
    path: '/settings',
    getParentRoute: () => rootRoute,
  } as never)
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <p>Home screen</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([welcomeRoute, settingsRoute, homeRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return { router, ...view }
}

const goNext = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }))
const goBack = () => userEvent.click(screen.getByRole('button', { name: 'Back' }))
const stepTitle = () => screen.getByRole('heading', { level: 2 })

async function reachStep(step: number) {
  await screen.findByText('Step 1 of 4')
  for (let current = 1; current < step; current++) {
    await goNext()
    await screen.findByText(`Step ${current + 1} of 4`)
  }
}

beforeEach(() => {
  useSettingsStore.setState({ onboardingCompleted: false, advancedMode: false })
  vi.mocked(checkCaptureServiceStatus).mockResolvedValue({ running: true, error: null })
  vi.mocked(getGames).mockResolvedValue(GAMES)
  vi.mocked(toggleGameMonitored).mockResolvedValue(undefined)
  vi.mocked(getAppSettings).mockResolvedValue({
    minimizeToTray: true,
    sessionRetentionDays: 365,
    locale: null,
    alerts: { criticalAlert: true, doNotDisturb: false, recap: 'changed' },
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Welcome flow', () => {
  it('starts with a sentence, an example route and the language', async () => {
    const { container } = renderFlow()

    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument()
    expect(stepTitle()).toHaveTextContent('The route from your PC to the game server')
    expect(screen.getByText(/shows how many milliseconds each operator adds/)).toBeInTheDocument()
    const strip = container.querySelector('[data-slot=route-strip]')!
    expect(within(strip as HTMLElement).getByText('RETN')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot=card]')).not.toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('goes through the four steps and back', async () => {
    renderFlow()
    await reachStep(2)
    expect(stepTitle()).toHaveTextContent('A Windows service watches game connections')

    await goNext()
    await screen.findByText('Step 3 of 4')
    expect(stepTitle()).toHaveTextContent('3 games found on this PC')

    await goBack()
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument()

    await goNext()
    await goNext()
    expect(await screen.findByText('Step 4 of 4')).toBeInTheDocument()
    expect(stepTitle()).toHaveTextContent('Your measurements stay on this PC')

    await goBack()
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument()
  })

  it('states the capture service and the absence of admin rights', async () => {
    renderFlow()
    await reachStep(2)

    expect(screen.getByText(/The app itself runs without administrator rights/)).toBeInTheDocument()
    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restart service' })).not.toBeInTheDocument()
  })

  it('offers to restart a service that does not answer, without blocking', async () => {
    vi.mocked(checkCaptureServiceStatus).mockResolvedValue({ running: false, error: null })
    vi.mocked(restartCaptureService).mockResolvedValue(undefined)
    renderFlow()
    await reachStep(2)

    const notice = await screen.findByRole('status')
    expect(within(notice).getByText('The capture service is not responding')).toBeInTheDocument()
    expect(within(notice).getByText(/can’t see game servers over UDP/)).toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()

    await userEvent.click(within(notice).getByRole('button', { name: 'Restart service' }))
    expect(restartCaptureService).toHaveBeenCalledTimes(1)

    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await goNext()
    expect(await screen.findByText('Step 3 of 4')).toBeInTheDocument()
  })

  it('lists the games found and switches monitoring', async () => {
    let library = GAMES
    vi.mocked(getGames).mockImplementation(() => Promise.resolve(library))
    vi.mocked(toggleGameMonitored).mockImplementation((id, monitored) => {
      library = library.map(item => (item.id === id ? { ...item, monitored } : item))
      return Promise.resolve()
    })
    renderFlow()
    await reachStep(3)

    const league = await screen.findByRole('switch', { name: 'League of Legends' })
    expect(league).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Rocket League' })).not.toBeChecked()
    expect(screen.getByText('Riot')).toBeInTheDocument()

    await userEvent.click(league)
    expect(toggleGameMonitored).toHaveBeenCalledWith(1, false)
    await waitFor(() => expect(league).not.toBeChecked())
  })

  it('says so when no game is found and lets the player search again', async () => {
    vi.mocked(getGames).mockResolvedValue([])
    vi.mocked(scanAllGames).mockResolvedValue({ gamesFound: 0, gamesAdded: 0, gamesUpdated: 0 })
    renderFlow()
    await reachStep(3)

    expect(await screen.findByText('No game found. Search again or add one by hand.')).toBeVisible()
    expect(stepTitle()).toHaveTextContent('No game found yet')

    await userEvent.click(screen.getByRole('button', { name: 'Search again' }))
    expect(scanAllGames).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Add a game' })).toBeInTheDocument()
  })

  it('lists what stays on the PC, with no sharing option, and finishes on the home screen', async () => {
    renderFlow()
    await reachStep(4)

    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(
      screen.getByText(
        'No data is sent. Sessions and measurements are stored in a local database, with no account.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'For LoL, TFT and VALORANT, GameRoute reads the ping the game writes in its own logs, in read-only mode. Nothing leaves your PC.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(/connects to GitHub for updates, Steam for game images and CARTO/)
    ).toBeInTheDocument()
    expect(screen.getByText(/your router.*to the last router of your ISP/)).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: 'Start GameRoute with Windows' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Detailed view' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('switch', { name: 'Detailed view' }))
    expect(useSettingsStore.getState().advancedMode).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Launch GameRoute' }))
    expect(useSettingsStore.getState().onboardingCompleted).toBe(true)
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
  })

  it('can be replayed from the settings', async () => {
    useSettingsStore.setState({ onboardingCompleted: true })
    const { router } = renderFlow('/settings')

    await userEvent.click(await screen.findByRole('button', { name: 'Show again' }))

    expect(useSettingsStore.getState().onboardingCompleted).toBe(false)
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'))
    expect(await screen.findByText('Step 1 of 4')).toBeInTheDocument()
  })
})

describe('Welcome texts', () => {
  const onboarding = Object.entries(messages).map(([file, strings]) => ({
    file,
    strings: Object.fromEntries(
      Object.entries(strings).filter(([key]) => key.startsWith('onboarding_'))
    ),
  }))

  it('exists in every language', () => {
    const keys = onboarding.map(({ strings }) => Object.keys(strings).sort())
    expect(keys[0].length).toBeGreaterThan(15)
    for (const other of keys) expect(other).toEqual(keys[0])
  })

  it('names no third-party lookup and promises no telemetry, sharing or mode choice', () => {
    for (const { file, strings } of onboarding) {
      expect(JSON.stringify(strings), file).not.toMatch(/ip-api|télémétrie|telemetry|telemetría/i)
      expect(JSON.stringify(strings), file).not.toMatch(/anonym|share|partag|compart/i)
    }
  })
})

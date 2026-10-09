import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import { useSettingsStore } from '@/stores/settings-store'
import { useAutoStartMonitoring } from '@/hooks/use-auto-start-monitoring'
import { Route as RootRoute } from './__root'

vi.mock('@/hooks/use-auto-start-monitoring', () => ({ useAutoStartMonitoring: vi.fn() }))
vi.mock('@/hooks/use-monitoring-events', () => ({ useMonitoringEvents: vi.fn() }))
vi.mock('@/hooks/use-live-samples', () => ({ useLiveSamples: vi.fn() }))
vi.mock('@/hooks/use-traceroute-events', () => ({ useTracerouteEvents: vi.fn() }))
vi.mock('@/hooks/use-sync-locale', () => ({ useSyncLocale: vi.fn() }))
vi.mock('@/hooks/use-match-end-toast', () => ({ useMatchEndToast: vi.fn() }))
vi.mock('@/hooks/use-service-health-check', () => ({
  useServiceHealthCheck: () => ({ isServiceRunning: true, isLoading: false }),
}))
vi.mock('@/components/sidebar/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/header', () => ({ Header: () => null }))
vi.mock('@/components/update-dialog', () => ({ UpdateDialog: () => null }))
vi.mock('@/lib/updater', () => ({ checkForAppUpdatesOnStartup: vi.fn() }))
vi.mock('@/lib/tauri', () => ({ restartCaptureService: vi.fn() }))

function renderApp(initialPath: string) {
  const homeRoute = createRoute({
    getParentRoute: () => RootRoute,
    path: '/',
    component: () => <p>Home screen</p>,
  })
  const welcomeRoute = createRoute({
    getParentRoute: () => RootRoute,
    path: '/welcome',
    component: () => <p>Welcome screen</p>,
  })
  const router = createRouter({
    routeTree: RootRoute.addChildren([homeRoute, welcomeRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

beforeAll(() => {
  window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

beforeEach(() => {
  useSettingsStore.setState({ onboardingCompleted: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('First launch', () => {
  it('opens the welcome flow before anything else loads', async () => {
    const router = renderApp('/')

    expect(await screen.findByText('Welcome screen')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/welcome')
    expect(screen.queryByText('Home screen')).not.toBeInTheDocument()
  })

  it('does not start monitoring until the welcome flow is done', async () => {
    renderApp('/')
    await screen.findByText('Welcome screen')

    expect(useAutoStartMonitoring).not.toHaveBeenCalled()
  })

  it('starts monitoring once the welcome flow is completed', async () => {
    useSettingsStore.setState({ onboardingCompleted: true })
    const router = renderApp('/')

    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(useAutoStartMonitoring).toHaveBeenCalled()
  })

  it('leaves the welcome flow for the home screen when it is already completed', async () => {
    useSettingsStore.setState({ onboardingCompleted: true })
    const router = renderApp('/welcome')

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
  })
})

import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { useMonitoringStore } from '@/stores/monitoring-store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './app-sidebar'

vi.mock('@/lib/tauri', () => ({
  checkCaptureServiceStatus: vi.fn().mockResolvedValue({ running: true }),
  startMonitoring: vi.fn().mockResolvedValue(undefined),
  stopMonitoring: vi.fn().mockResolvedValue(undefined),
  listRunningApps: vi.fn().mockResolvedValue([]),
  startManualMonitoring: vi.fn().mockResolvedValue(undefined),
  getUsualRoute: vi.fn().mockResolvedValue([]),
}))

beforeAll(() => {
  window.scrollTo = vi.fn()
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  useMonitoringStore.getState().reset()
})

const game = {
  gameName: 'Valorant',
  pid: 1234,
  detectedAt: '2026-01-31T10:00:00Z',
  exePath: null,
  icon: null,
  isManual: false,
}

async function renderSidebar(path: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    ),
  })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  return screen.findByRole('link', { name: 'Home' })
}

const navLinks = () =>
  screen
    .getAllByRole('link')
    .filter(link => link.closest('[data-sidebar=menu-item]') && link.textContent !== 'GameRoute')

describe('AppSidebar', () => {
  it('lists the v2 entries and nothing that is not ready yet', async () => {
    await renderSidebar('/')

    expect(navLinks().map(link => link.textContent)).toEqual([
      'Home',
      'Live',
      'Sessions',
      'Games',
      'Route',
      'History',
      'Reports',
      'Settings',
      'Help',
    ])
    expect(screen.getByText('Analysis')).toBeInTheDocument()
  })

  it('marks the entry of the current screen as the page', async () => {
    await renderSidebar('/sessions/42')

    const current = navLinks().filter(link => link.getAttribute('aria-current') === 'page')
    expect(current.map(link => link.textContent)).toEqual(['Sessions'])
  })

  it('shows the old trace screen as the live entry', async () => {
    await renderSidebar('/trace')

    expect(screen.getByRole('link', { name: 'Live' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows a single live dot, on the live entry, while a match is measured', async () => {
    useMonitoringStore.setState({ isMonitoring: true, currentGame: game })
    useMonitoringStore.getState().addCapturedIp({
      ip: '203.0.113.200',
      port: 7220,
      protocol: 'udp',
      capturedAt: '2026-01-31T10:00:00Z',
      packetCount: 12,
    })
    await renderSidebar('/')

    const dots = document.querySelectorAll('[data-slot=live-dot]')
    expect(dots).toHaveLength(1)
    expect(dots[0].closest('a')).toHaveTextContent('Live')

    const monitor = document.querySelector<HTMLElement>('[data-slot=sidebar-monitor]')!
    expect(within(monitor).getByRole('status')).toHaveTextContent('In match')
    expect(monitor).toHaveTextContent('203.0.113.200 · UDP 7220')
    expect(within(monitor).getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('has no live dot while waiting for the match', async () => {
    useMonitoringStore.setState({ isMonitoring: true, currentGame: game })
    await renderSidebar('/')

    expect(document.querySelectorAll('[data-slot=live-dot]')).toHaveLength(0)
    const monitor = document.querySelector<HTMLElement>('[data-slot=sidebar-monitor]')!
    expect(within(monitor).getByRole('status')).toHaveTextContent('Measuring')
    expect(monitor).toHaveTextContent('Waiting for the match')
  })

  it('offers to start monitoring when it is stopped', async () => {
    await renderSidebar('/')

    const monitor = document.querySelector<HTMLElement>('[data-slot=sidebar-monitor]')!
    expect(within(monitor).getByRole('status')).toHaveTextContent('Monitoring stopped')
    expect(within(monitor).getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })
})

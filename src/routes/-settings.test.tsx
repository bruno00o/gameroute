import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { AppSettings } from '@/types/backend'
import {
  deleteAllData,
  getAppSettings,
  getIpMetadataStats,
  getLiveProbeConfig,
  getStorageStats,
  setLiveProbeConfig,
  setMinimizeToTray,
  setSessionRetention,
} from '@/lib/tauri'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { Route as GeneralRoute } from './settings.index'
import { Route as PrivacyRoute } from './settings.privacy'
import { Route as CaptureRoute } from './settings.capture'

vi.mock('@tanstack/react-router', async importOriginal => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/tauri', () => ({
  getAppSettings: vi.fn(),
  setMinimizeToTray: vi.fn(),
  setSessionRetention: vi.fn(),
  getStorageStats: vi.fn(),
  deleteAllData: vi.fn(),
  getIpMetadataStats: vi.fn(),
  pruneIpMetadataCache: vi.fn(),
  clearIpMetadataCache: vi.fn(),
  openLogDir: vi.fn(),
  getLiveProbeConfig: vi.fn(),
  setLiveProbeConfig: vi.fn(),
  restartCaptureService: vi.fn(),
  checkCaptureServiceStatus: vi.fn(() => Promise.resolve({ running: true, error: null })),
}))

vi.mock('@tauri-apps/api/app', () => ({ getVersion: () => Promise.resolve('0.1.18') }))
vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: () => Promise.resolve(true),
  enable: vi.fn(),
  disable: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))

const settings: AppSettings = { minimizeToTray: true, sessionRetentionDays: 365 }

function renderRoute(route: { options: { component?: unknown } }) {
  const Screen = route.options.component as React.ComponentType
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Screen />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(getAppSettings).mockResolvedValue(settings)
  vi.mocked(getStorageStats).mockResolvedValue({
    databaseBytes: 10_400_000,
    sessionCount: 70,
    addressCount: 7878,
    geoliteBuiltAt: '2026-04-20T00:00:00+00:00',
  })
  vi.mocked(getIpMetadataStats).mockResolvedValue({
    memoryEntries: 0,
    sqliteEntries: 412,
    entriesWithAsn: 400,
    entriesWithGeo: 380,
    oldestEntry: null,
  })
  useMonitoringStore.setState({ isMonitoring: false, currentGame: null })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('General settings', () => {
  it('groups the settings under headings, not cards', async () => {
    renderRoute(GeneralRoute)

    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'Language and display',
      'Startup',
      'Updates and troubleshooting',
    ])
    expect(document.querySelector('[data-slot=card], [data-slot=panel]')).toBeNull()
    expect(await screen.findByText('Version 0.1.18')).toBeInTheDocument()
  })

  it('offers dark, light and Windows themes by name', () => {
    renderRoute(GeneralRoute)

    const theme = screen.getByRole('group', { name: 'Theme' })
    expect(
      within(theme)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual(['Dark', 'Light', 'Match Windows'])
  })

  it('saves the notification area setting in the app', async () => {
    vi.mocked(setMinimizeToTray).mockResolvedValue({ ...settings, minimizeToTray: false })
    renderRoute(GeneralRoute)

    const toggle = screen.getByRole('switch', { name: 'Keep GameRoute in the notification area' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toBeChecked()

    await userEvent.click(toggle)

    expect(vi.mocked(setMinimizeToTray).mock.calls[0][0]).toBe(false)
    await waitFor(() => expect(toggle).not.toBeChecked())
  })
})

describe('Capture settings', () => {
  it('describes only the capture service, without a mode choice', async () => {
    renderRoute(CaptureRoute)

    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('Capture service')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(await screen.findByText('Running. The service answers GameRoute.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restart service/ })).not.toBeInTheDocument()
  })
})

describe('Live probe settings', () => {
  const config = { enabled: true, floor: true, region: true, beacons: [] }

  it('saves the access probe and region beacon switches', async () => {
    vi.mocked(getLiveProbeConfig).mockResolvedValue(config)
    vi.mocked(setLiveProbeConfig).mockImplementation(async c => c)
    renderRoute(CaptureRoute)

    const floor = await screen.findByRole('switch', { name: /Access probe/ })
    await waitFor(() => expect(floor).toBeChecked())
    await userEvent.click(floor)
    await waitFor(() =>
      expect(setLiveProbeConfig).toHaveBeenCalledWith(
        { ...config, floor: false },
        expect.anything()
      )
    )

    await userEvent.click(screen.getByRole('switch', { name: /Region beacon/ }))
    await waitFor(() =>
      expect(setLiveProbeConfig).toHaveBeenLastCalledWith(
        { ...config, floor: false, region: false },
        expect.anything()
      )
    )
  })
})

describe('Privacy settings', () => {
  it('shows what is stored on this PC and where GameRoute connects', async () => {
    renderRoute(PrivacyRoute)

    expect(await screen.findByText('10 MB')).toBeInTheDocument()
    expect(screen.getByText('70')).toBeInTheDocument()
    expect(screen.getByText('7,878')).toBeInTheDocument()
    expect(
      screen.getByText(/GitHub for updates, Steam for game images and CARTO/)
    ).toBeInTheDocument()
    expect(await screen.findByText(/^412 addresses cached\./)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('keeps sessions for a year by default and saves another choice', async () => {
    vi.mocked(setSessionRetention).mockResolvedValue({ ...settings, sessionRetentionDays: null })
    renderRoute(PrivacyRoute)

    const retention = await screen.findByRole('group', { name: 'Keep sessions' })
    expect(within(retention).getByRole('button', { name: '1 year' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      within(retention)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual(['3 months', '6 months', '1 year', '2 years', 'Forever'])

    await userEvent.click(within(retention).getByRole('button', { name: 'Forever' }))

    expect(vi.mocked(setSessionRetention).mock.calls[0][0]).toBeNull()
    expect(await screen.findByText('Your sessions stay until you delete them.')).toBeInTheDocument()

    await userEvent.click(within(retention).getByRole('button', { name: '3 months' }))
    expect(vi.mocked(setSessionRetention).mock.calls[1][0]).toBe(90)
  })

  it('asks before deleting everything', async () => {
    vi.mocked(deleteAllData).mockResolvedValue()
    renderRoute(PrivacyRoute)

    await userEvent.click(screen.getByRole('button', { name: 'Delete all data' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Your settings and games stay/)).toBeInTheDocument()
    expect(deleteAllData).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteAllData).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete all data' }))
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete everything',
      })
    )
    await waitFor(() => expect(deleteAllData).toHaveBeenCalledOnce())
  })

  it('does not delete everything while monitoring', () => {
    useMonitoringStore.setState({ isMonitoring: true })
    renderRoute(PrivacyRoute)

    expect(screen.getByRole('button', { name: 'Delete all data' })).toBeDisabled()
    expect(screen.getByText(/Stop monitoring to delete everything\./)).toBeInTheDocument()
  })
})

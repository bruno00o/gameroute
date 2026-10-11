import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { AppSettings } from '@/types/backend'
import { getAppSettings, getSeverityThresholds, setAlertSettings } from '@/lib/tauri'
import { thresholds } from '@/test/session-fixtures'
import { Route as AlertsRoute } from './settings.alerts'

vi.mock('@/lib/tauri', () => ({
  getAppSettings: vi.fn(),
  setAlertSettings: vi.fn(),
  getSeverityThresholds: vi.fn(),
}))

const settings: AppSettings = {
  minimizeToTray: true,
  sessionRetentionDays: 365,
  locale: 'en',
  alerts: { criticalAlert: true, doNotDisturb: false, recap: 'changed' },
}

function renderScreen() {
  const Screen = AlertsRoute.options.component as React.ComponentType
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Screen />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(getAppSettings).mockResolvedValue(settings)
  vi.mocked(getSeverityThresholds).mockResolvedValue(thresholds())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Alert settings', () => {
  it('groups the settings under headings, not cards', async () => {
    renderScreen()

    expect(await screen.findByRole('heading', { name: 'Thresholds' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'During the match',
      'After the match',
      'Thresholds',
    ])
    expect(document.querySelector('[data-slot=card], [data-slot=panel]')).toBeNull()
  })

  it('warns on critical by default and says what critical means', async () => {
    renderScreen()

    const toggle = screen.getByRole('switch', {
      name: 'Warn me when the connection turns critical',
    })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toBeChecked()
    expect(
      screen.getByRole('switch', { name: 'Do not disturb during the match' })
    ).not.toBeChecked()
    expect(
      await screen.findByText(
        /after 30 s in the critical state: loss of at least 5%, jitter of at least 30 ms or ping 100 ms above your usual/
      )
    ).toBeInTheDocument()
  })

  it('offers no level below critical', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Thresholds' })

    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('saves the critical alert switch with the other alert choices', async () => {
    vi.mocked(setAlertSettings).mockImplementation(async alerts => ({ ...settings, alerts }))
    renderScreen()

    const toggle = screen.getByRole('switch', {
      name: 'Warn me when the connection turns critical',
    })
    await waitFor(() => expect(toggle).toBeEnabled())
    await userEvent.click(toggle)

    expect(vi.mocked(setAlertSettings).mock.calls[0][0]).toEqual({
      criticalAlert: false,
      doNotDisturb: false,
      recap: 'changed',
    })
    await waitFor(() => expect(toggle).not.toBeChecked())
  })

  it('saves do not disturb and the summary choice', async () => {
    vi.mocked(setAlertSettings).mockImplementation(async alerts => ({ ...settings, alerts }))
    renderScreen()

    const quiet = screen.getByRole('switch', { name: 'Do not disturb during the match' })
    await waitFor(() => expect(quiet).toBeEnabled())
    await userEvent.click(quiet)
    expect(vi.mocked(setAlertSettings).mock.calls[0][0].doNotDisturb).toBe(true)

    const recap = await screen.findByRole('group', { name: 'Show the summary' })
    expect(
      within(recap)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual(['Always', 'If something moved', 'Never'])
    await userEvent.click(within(recap).getByRole('button', { name: 'Never' }))
    await waitFor(() =>
      expect(vi.mocked(setAlertSettings).mock.calls[1][0]).toEqual({
        criticalAlert: true,
        doNotDisturb: true,
        recap: 'never',
      })
    )
  })

  it('reads the thresholds from the backend', async () => {
    renderScreen()

    const table = await screen.findByRole('table', { name: 'Thresholds of each status' })
    const critical = within(table).getAllByRole('row')[3]
    expect(critical).toHaveTextContent('Critical')
    expect(critical).toHaveTextContent('≥ 5%')
    expect(critical).toHaveTextContent('≥ 30 ms')
    expect(critical).toHaveTextContent('+100 ms')
  })
})

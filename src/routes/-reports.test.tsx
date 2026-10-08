import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { SessionListItem, SessionMatch } from '@/types/backend'
import { getSessionDetail, getSessionList, getSessionMatches } from '@/lib/tauri'
import { measure, sessionDetail, sessionMatches } from '@/test/session-fixtures'
import { Route } from './reports'

vi.mock('@/lib/tauri', () => ({
  getSessionDetail: vi.fn(),
  getSessionList: vi.fn(),
  getSessionMatches: vi.fn(),
  writeExportFile: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function listItem(overrides: Partial<SessionListItem> = {}): SessionListItem {
  const detail = sessionDetail()
  return {
    id: 1,
    gameName: detail.gameName,
    startedAt: detail.startedAt,
    endedAt: detail.endedAt,
    endEstimated: false,
    uniqueIpCount: 2,
    tracerouteCount: 2,
    matchCount: 3,
    medianPingMs: 17.6,
    medianPingAtLeast: true,
    medianPingByGame: false,
    status: 'watch',
    ...overrides,
  }
}

function withWatchOnSecond(): SessionMatch[] {
  return sessionMatches().map(match =>
    match.number === 2
      ? { ...match, status: 'watch', trace: measure({ pingMs: 44, lossPct: 0, jitterMs: 9 }) }
      : match
  )
}

function mockSessions(matches: SessionMatch[] = withWatchOnSecond()) {
  vi.mocked(getSessionList).mockResolvedValue({
    items: [listItem()],
    total: 1,
    recorded: 1,
    firstStartedAt: sessionDetail().startedAt,
    games: ['VALORANT'],
  })
  vi.mocked(getSessionMatches).mockResolvedValue(matches)
  vi.mocked(getSessionDetail).mockResolvedValue(sessionDetail())
}

function renderPage() {
  const ReportsPage = Route.options.component!
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReportsPage />
    </QueryClientProvider>
  )
}

const preview = () => document.querySelector('[data-slot=report-preview]')!

beforeEach(() => {
  vi.spyOn(Route, 'useSearch').mockReturnValue({})
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  mockSessions()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Reports', () => {
  it('lists the matches and ticks the one that departs from the usual ping with a comparison match', async () => {
    renderPage()

    const second = await screen.findByRole('checkbox', { name: /match 2/ })
    expect(second).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /match 1/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /match 3/ })).not.toBeChecked()
  })

  it('previews the text of the selected matches and copies exactly that text', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    renderPage()

    await waitFor(() => expect(preview()).toHaveTextContent('GameRoute connection report'))
    expect(preview()).toHaveTextContent('Measurement limits')
    expect(preview()).toHaveTextContent('Local connection type (Wi-Fi or cable): not measured.')

    await user.click(screen.getByRole('button', { name: 'Copy the text' }))

    expect(writeText).toHaveBeenCalledWith(preview().textContent)
    expect(toast.success).toHaveBeenCalledWith('Report copied')
  })

  it('keeps the address of the box out of the text until asked', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(preview()).toHaveTextContent('Hops:'))
    expect(preview().textContent).not.toContain('192.168.1.254')

    await user.click(screen.getByRole('switch', { name: 'Addresses of your local network' }))

    expect(preview().textContent).toContain('192.168.1.254')
    expect(preview()).toHaveTextContent('Local network addresses are included in this report.')
  })

  it('drops the route and the hops when switched off', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('Hops:'))

    await user.click(screen.getByRole('switch', { name: 'Route by operator' }))
    await user.click(screen.getByRole('switch', { name: 'Hop details, for the technician' }))

    expect(preview().textContent).not.toContain('Route:')
    expect(preview().textContent).not.toContain('Hops:')
  })

  it('changes the address line with the recipient', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('For SFR support'))

    await user.click(screen.getByRole('button', { name: 'Forum or Discord' }))

    expect(preview()).toHaveTextContent('For a forum or a Discord server')
  })

  it('has nothing to copy once every match is unticked', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('Summary'))

    for (const box of screen.getAllByRole('checkbox')) {
      if ((box as HTMLInputElement).checked) await user.click(box)
    }

    expect(preview()).toHaveTextContent('No match selected.')
    expect(screen.getByRole('button', { name: 'Copy the text' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save as .txt' })).toBeDisabled()
  })

  it('explains what a report needs when no match was recorded', async () => {
    vi.mocked(getSessionList).mockResolvedValue({
      items: [],
      total: 0,
      recorded: 0,
      firstStartedAt: null,
      games: [],
    })
    renderPage()

    expect(await screen.findByText('No match recorded')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('offers to retry when the matches cannot be loaded', async () => {
    vi.mocked(getSessionMatches).mockRejectedValue(new Error('boom'))
    renderPage()

    const notice = await screen.findByText('Could not load the matches.')
    expect(
      within(notice.closest('[data-slot=notice]') ?? document.body).getByRole('button')
    ).toBeInTheDocument()
  })
})

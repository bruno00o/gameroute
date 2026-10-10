import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { SessionListItem, SessionMatch } from '@/types/backend'
import { save } from '@tauri-apps/plugin-dialog'
import { getSessionDetail, getSessionList, getSessionMatches, writeExportPdf } from '@/lib/tauri'
import { measure, sessionDetail, sessionMatches } from '@/test/session-fixtures'
import { Route } from './reports'

vi.mock('@/lib/tauri', () => ({
  getSessionDetail: vi.fn(),
  getSessionList: vi.fn(),
  getSessionMatches: vi.fn(),
  writeExportFile: vi.fn(),
  writeExportPdf: vi.fn(),
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
  vi.mocked(writeExportPdf).mockReset()
  vi.mocked(save).mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  mockSessions()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Reports', () => {
  it('lists only the matches with a problem, ticked, and counts them', async () => {
    renderPage()

    const second = await screen.findByRole('checkbox', { name: /match 2/ })
    expect(second).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /match 1/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /match 3/ })).not.toBeInTheDocument()
    expect(screen.getByText('Matches selected: 1')).toBeInTheDocument()
  })

  it('adds the matches without problem on request, with one ticked to compare', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('checkbox', { name: /match 2/ })

    await user.click(screen.getByRole('switch', { name: 'Also show matches without problem' }))

    expect(screen.getByRole('checkbox', { name: /match 1/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /match 2/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /match 3/ })).not.toBeChecked()
    expect(screen.getByText('Matches selected: 2')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Also show matches without problem' }))

    expect(screen.queryByRole('checkbox', { name: /match 1/ })).not.toBeInTheDocument()
    expect(screen.getByText('Matches selected: 1')).toBeInTheDocument()
  })

  it('says so when no match has a problem and keeps the option to show them all', async () => {
    const user = userEvent.setup()
    mockSessions(sessionMatches())
    renderPage()

    expect(
      await screen.findByText('No match with a problem in the recent sessions.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('Matches selected: 0')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Also show matches without problem' }))

    expect(screen.getByRole('checkbox', { name: /match 2/ })).toBeChecked()
  })

  it('shows all the matches from the start when opened on a session without problem', async () => {
    vi.spyOn(Route, 'useSearch').mockReturnValue({ session: 1 })
    mockSessions(sessionMatches())
    renderPage()

    expect(await screen.findByRole('checkbox', { name: /match 2/ })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Also show matches without problem' })).toBeChecked()
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

  it('saves the same report as a dated PDF at the chosen path', async () => {
    const user = userEvent.setup()
    vi.mocked(save).mockResolvedValue('C:\\Reports\\gameroute.pdf')
    vi.mocked(writeExportPdf).mockResolvedValue()
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('Hops:'))

    await user.click(screen.getByRole('button', { name: 'Create PDF' }))

    await waitFor(() => expect(writeExportPdf).toHaveBeenCalledTimes(1), { timeout: 15000 })
    const [path, bytes] = vi.mocked(writeExportPdf).mock.calls[0]
    expect(path).toBe('C:\\Reports\\gameroute.pdf')
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^gameroute-report-\d{4}-\d{2}-\d{2}\.pdf$/),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
    )
    expect(toast.success).toHaveBeenCalledWith('Report saved')
  }, 20000)

  it('writes nothing when the save dialog is dismissed', async () => {
    const user = userEvent.setup()
    vi.mocked(save).mockResolvedValue(null)
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('Hops:'))

    await user.click(screen.getByRole('button', { name: 'Create PDF' }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(writeExportPdf).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('changes the address line with the recipient', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('For SFR support'))

    await user.click(screen.getByRole('button', { name: 'VALORANT support' }))
    expect(preview()).toHaveTextContent('For VALORANT support')

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

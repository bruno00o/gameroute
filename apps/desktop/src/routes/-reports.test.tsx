import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { SessionListItem, SessionMatch } from '@/types/backend'
import type { ReportPayload } from '@gameroute/shared'
import { save } from '@tauri-apps/plugin-dialog'
import {
  deleteSharedReport,
  getSessionDetail,
  getSessionList,
  getSessionMatches,
  getSeverityThresholds,
  listSharedReports,
  openExternalUrl,
  shareReport,
  writeExportPdf,
} from '@/lib/tauri'
import { measure, sessionDetail, sessionMatches, thresholds } from '@/test/session-fixtures'
import { Route } from './reports'

vi.mock('@/lib/tauri', () => ({
  deleteSharedReport: vi.fn(),
  getSessionDetail: vi.fn(),
  getSessionList: vi.fn(),
  getSessionMatches: vi.fn(),
  getSeverityThresholds: vi.fn(),
  listSharedReports: vi.fn(),
  openExternalUrl: vi.fn(),
  shareReport: vi.fn(),
  writeExportFile: vi.fn(),
  writeExportPdf: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn().mockResolvedValue('0.1.20') }))

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
    games: [{ name: 'VALORANT', sessionCount: 1 }],
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
  vi.mocked(shareReport).mockReset()
  vi.mocked(deleteSharedReport).mockReset()
  vi.mocked(openExternalUrl).mockReset().mockResolvedValue()
  vi.mocked(getSeverityThresholds).mockResolvedValue(thresholds())
  vi.mocked(listSharedReports).mockResolvedValue([])
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

describe('Reports, sharing online', () => {
  const link = {
    id: 'k3J9x',
    url: 'https://gameroute.test/r/k3J9x',
    expiresAt: '2027-01-09T09:00:00.000Z',
  }

  async function openShare(user: ReturnType<typeof userEvent.setup>) {
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('Hops:'))
    await user.click(screen.getByRole('button', { name: 'Share online' }))
    return screen.findByRole('dialog')
  }

  const sharePreview = () => document.querySelector('[data-slot=share-preview]')!

  it('shows what will be sent before anything leaves the PC', async () => {
    const user = userEvent.setup()
    const dialog = await openShare(user)

    await waitFor(() => expect(sharePreview()).toHaveTextContent('VALORANT'))
    expect(sharePreview()).toHaveTextContent('SFR, AS15557')
    expect(sharePreview()).toHaveTextContent('RETN (AS9002)')
    expect(sharePreview()).toHaveTextContent('77.136.10.6, 87.245.233.46, 162.249.72.5')
    expect(sharePreview()).toHaveTextContent('Match 2')
    expect(sharePreview()).toHaveTextContent('Never sent: your IP address')
    expect(dialog.textContent).not.toContain('192.168.1.254')
    expect(within(dialog).getByRole('switch', { name: 'Share exact times' })).not.toBeChecked()
    expect(shareReport).not.toHaveBeenCalled()
  })

  it('shows the raw JSON and sends exact times only when asked', async () => {
    const user = userEvent.setup()
    vi.mocked(shareReport).mockResolvedValue(link)
    const dialog = await openShare(user)
    await waitFor(() => expect(sharePreview()).toBeInTheDocument())

    await user.click(within(dialog).getByRole('button', { name: 'Raw data (JSON)' }))
    const raw = () => document.querySelector('[data-slot=share-raw]')?.textContent ?? 'null'
    await waitFor(() => expect(JSON.parse(raw())?.exactTimes).toBe(false))

    await user.click(within(dialog).getByRole('switch', { name: 'Share exact times' }))
    const shown = JSON.parse(raw())
    expect(shown.exactTimes).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(shareReport).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(shareReport).mock.calls[0][0] as ReportPayload
    expect(sent).toEqual(shown)
    expect(sent.matches[0].startedAt).toBe(new Date(withWatchOnSecond()[1].startedAt).toISOString())
  })

  it('gives the link with copy, open and the expiry date once shared', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    vi.mocked(shareReport).mockResolvedValue(link)
    const dialog = await openShare(user)
    await waitFor(() => expect(sharePreview()).toBeInTheDocument())

    await user.click(within(dialog).getByRole('button', { name: 'Share' }))

    expect(await within(dialog).findByText('Report shared')).toBeInTheDocument()
    expect(within(dialog).getByText(link.url)).toBeInTheDocument()
    expect(within(dialog).getByText('The link works until Jan 9, 2027.')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(link.url)
    await user.click(within(dialog).getByRole('button', { name: 'Open' }))
    expect(openExternalUrl).toHaveBeenCalledWith(link.url)
  })

  it('deletes the report it just shared', async () => {
    const user = userEvent.setup()
    vi.mocked(shareReport).mockResolvedValue(link)
    vi.mocked(deleteSharedReport).mockResolvedValue()
    const dialog = await openShare(user)
    await waitFor(() => expect(sharePreview()).toBeInTheDocument())
    await user.click(within(dialog).getByRole('button', { name: 'Share' }))
    await within(dialog).findByText('Report shared')

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteSharedReport).toHaveBeenCalledWith(link.id))
    expect(toast.success).toHaveBeenCalledWith('Online report deleted')
  })

  it('explains a failed share and keeps the dialog open to retry', async () => {
    const user = userEvent.setup()
    vi.mocked(shareReport).mockRejectedValue({ code: 'SHARE_RATE_LIMITED', message: '429' })
    const dialog = await openShare(user)
    await waitFor(() => expect(sharePreview()).toBeInTheDocument())

    await user.click(within(dialog).getByRole('button', { name: 'Share' }))

    expect(
      await within(dialog).findByText(
        'Too many shares in a short time. Try again in a few minutes.'
      )
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeEnabled()
  })

  it('offers no online link for a game without a profile and says why', async () => {
    vi.mocked(getSessionDetail).mockResolvedValue(sessionDetail({ gameName: 'Rocket League' }))
    vi.mocked(getSessionList).mockResolvedValue({
      items: [listItem({ gameName: 'Rocket League' })],
      total: 1,
      recorded: 1,
      firstStartedAt: sessionDetail().startedAt,
      games: [{ name: 'Rocket League', sessionCount: 1 }],
    })
    renderPage()
    await waitFor(() => expect(preview()).toHaveTextContent('Hops:'))

    expect(screen.getByRole('button', { name: 'Share online' })).toBeDisabled()
    expect(
      screen.getByText(
        'Online sharing works for VALORANT, League of Legends, and Counter-Strike 2, not yet for Rocket League.'
      )
    ).toBeInTheDocument()
  })

  it('lists the shared reports and deletes one after confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(listSharedReports).mockResolvedValue([
      {
        ...link,
        gameName: 'VALORANT',
        recipient: 'isp',
        createdAt: '2026-10-11T09:00:00.000Z',
      },
    ])
    vi.mocked(deleteSharedReport).mockResolvedValue()
    renderPage()

    const row = await screen.findByText(link.url)
    const item = row.closest('[data-slot=shared-report]') as HTMLElement
    expect(within(item).getByText('VALORANT')).toBeInTheDocument()
    expect(within(item).getByText('Shared on Oct 11, expires on Jan 9, 2027')).toBeInTheDocument()

    await user.click(within(item).getByRole('button', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Delete this online report?')
    expect(deleteSharedReport).not.toHaveBeenCalled()

    vi.mocked(listSharedReports).mockResolvedValue([])
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteSharedReport).toHaveBeenCalledWith(link.id))
    await waitFor(() => expect(screen.queryByText(link.url)).not.toBeInTheDocument())
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Update } from '@tauri-apps/plugin-updater'

import { useUpdateStore } from '@/lib/updater'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { UpdateDialog } from './update-dialog'

const { relaunch } = vi.hoisted(() => ({ relaunch: vi.fn() }))

vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }))

function offer(overrides: Partial<Update> = {}) {
  const update = {
    currentVersion: '0.1.18',
    version: '0.2.0',
    body: '### Features\n\n* **settings:** keep sessions for a year ([abc1234](https://example.com))',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Update
  act(() => useUpdateStore.setState({ pending: update }))
  return update
}

beforeEach(() => {
  relaunch.mockReset().mockResolvedValue(undefined)
  useMonitoringStore.setState({ currentGame: null, isMonitoring: false })
  useUpdateStore.setState({ pending: null, checkedAt: null })
})

afterEach(cleanup)

describe('UpdateDialog', () => {
  it('stays closed until an update is offered', () => {
    render(<UpdateDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows both versions and the release notes in the app language', async () => {
    render(<UpdateDialog />)
    offer()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('0.1.18 → 0.2.0')).toBeInTheDocument()
    expect(within(dialog).getByText('GameRoute 0.2.0 is available')).toBeInTheDocument()
    expect(within(dialog).getByRole('listitem')).toHaveTextContent('Keep sessions for a year')
    expect(within(dialog).getByText(/No match in progress/)).toBeInTheDocument()
  })

  it('warns that installing during a match stops its measurement', async () => {
    useMonitoringStore.setState({
      isMonitoring: true,
      currentGame: {
        gameName: 'VALORANT',
        pid: 1,
        detectedAt: '2026-10-08T10:00:00Z',
        exePath: null,
        icon: null,
        isManual: false,
      },
    })
    render(<UpdateDialog />)
    offer()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/VALORANT is being monitored/)).toBeInTheDocument()
  })

  it('installs and restarts on confirmation', async () => {
    render(<UpdateDialog />)
    const update = offer()

    await userEvent.click(await screen.findByRole('button', { name: 'Update and restart' }))

    await waitFor(() => expect(relaunch).toHaveBeenCalledOnce())
    expect(update.downloadAndInstall).toHaveBeenCalledOnce()
  })

  it('closes without installing when postponed', async () => {
    render(<UpdateDialog />)
    const update = offer()

    await userEvent.click(await screen.findByRole('button', { name: 'Later' }))

    expect(useUpdateStore.getState().pending).toBeNull()
    expect(update.downloadAndInstall).not.toHaveBeenCalled()
  })
})

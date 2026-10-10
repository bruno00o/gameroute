import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import type { RunningApp } from '@/types/backend'
import { listRunningApps, startManualMonitoring } from '@/lib/tauri'
import { ProcessSelector } from './process-selector'

vi.mock('@/lib/tauri', () => ({
  listRunningApps: vi.fn(),
  startManualMonitoring: vi.fn(),
}))

const apps: RunningApp[] = [
  { name: 'deadlock.exe', pid: 18324, processCount: 1, path: null, udpSockets: 1 },
  { name: 'Discord.exe', pid: 9216, processCount: 4, path: null, udpSockets: 3 },
  { name: 'notepad.exe', pid: 5012, processCount: 1, path: null, udpSockets: 0 },
]

function renderSelector(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ProcessSelector open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
  return onOpenChange
}

beforeEach(() => {
  vi.mocked(listRunningApps).mockResolvedValue(apps)
  vi.mocked(startManualMonitoring).mockReset()
})

afterEach(cleanup)

describe('ProcessSelector', () => {
  it('shows the UDP activity of every program and how many are open', async () => {
    renderSelector()

    const list = await screen.findByRole('list', { name: 'Running programs' })
    const items = within(list).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('deadlock.exe')
    expect(items[0]).toHaveTextContent('PID 18324')
    expect(items[0]).toHaveTextContent('1 UDP socket')
    expect(items[0]).not.toHaveTextContent('1 UDP sockets')
    expect(items[1]).toHaveTextContent('3 UDP sockets')
    expect(items[1]).toHaveTextContent('4 processes')
    expect(items[2]).toHaveTextContent('No UDP socket')
    expect(screen.getByText('3 programs open, those with UDP sockets first')).toBeInTheDocument()
  })

  it('only starts once a program is chosen', async () => {
    const onOpenChange = renderSelector()
    const user = userEvent.setup()

    const start = await screen.findByRole('button', { name: 'Watch' })
    expect(start).toBeDisabled()

    await user.click(await screen.findByRole('radio', { name: /Discord\.exe/ }))
    await user.click(screen.getByRole('button', { name: 'Watch Discord.exe' }))

    await waitFor(() => expect(startManualMonitoring).toHaveBeenCalledWith(9216))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('filters the programs by name', async () => {
    renderSelector()
    const user = userEvent.setup()

    await screen.findByRole('list', { name: 'Running programs' })
    await user.type(screen.getByRole('textbox', { name: 'Filter programs…' }), 'disc')

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Discord.exe')
  })
})

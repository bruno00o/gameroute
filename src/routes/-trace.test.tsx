import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'

import type {
  DbHop,
  OperatorRoute,
  RouteSegment,
  TracedTarget,
  TracerouteHopEvent,
  TracerouteServerIpCompleteEvent,
} from '@/types/backend'
import { cancelTraceroute, getIgnoredConnectionCount, traceAddress } from '@/lib/tauri'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { useTraceStore } from '@/stores/trace-store'
import { Route as TraceScreen } from './trace'

vi.mock('@/lib/tauri', () => ({
  cancelTraceroute: vi.fn(),
  traceAddress: vi.fn(),
  getIgnoredConnectionCount: vi.fn(),
  resolveAsn: vi.fn(() => Promise.resolve([])),
}))
vi.mock('@/components/route/route-map', () => ({ RouteMap: () => <div data-testid="route-map" /> }))

const GAME_IP = '162.249.72.5'
const VOICE_IP = '20.157.94.82'

const rootRoute = createRootRoute()
const traceRoute = TraceScreen.update({
  id: '/trace',
  path: '/trace',
  getParentRoute: () => rootRoute,
} as never)

function renderTrace() {
  const router = createRouter({
    routeTree: rootRoute.addChildren([traceRoute]),
    history: createMemoryHistory({ initialEntries: ['/trace'] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

function target(ip: string, kind: TracedTarget['kind'], port = 7220): TracedTarget {
  return { ip, kind, protocol: kind ? 'UDP' : 'ICMP', port: kind ? port : 0 }
}

function start(...targets: TracedTarget[]) {
  act(() => {
    useTraceStore.getState().setStarted({
      serverIpCount: targets.length,
      serverIps: targets.map(t => t.ip),
      targets,
      startedAt: '2026-10-08T20:00:00Z',
    })
  })
}

function begin(ip: string, index = 1, total = 1) {
  act(() => {
    useTraceStore
      .getState()
      .setProgress({ currentIp: ip, currentIndex: index, totalCount: total, progress: 0 })
  })
}

function hop(targetIp: string, hopNumber: number, rtt: number | null): TracerouteHopEvent {
  return {
    serverIpIndex: 1,
    targetIp,
    hopNumber,
    ip: rtt == null ? null : `10.0.0.${hopNumber}`,
    hostname: null,
    rttMs: rtt,
    rttMin: rtt,
    rttMax: rtt,
    packetLoss: rtt == null ? 100 : 0,
    timeout: rtt == null,
  }
}

function addHops(targetIp: string, ...rtts: (number | null)[]) {
  act(() => {
    rtts.forEach((rtt, i) => useTraceStore.getState().addHop(hop(targetIp, i + 1, rtt)))
  })
}

function dbHop(hopNumber: number, ip: string | null, rtt: number | null, loss = 0): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 0,
    hopNumber,
    ip,
    hostname: null,
    latencyMin: rtt,
    latencyAvg: rtt,
    latencyMax: rtt,
    packetLoss: ip ? loss : 100,
    isProblemHop: false,
    source: 'ICMP',
    lossStatus: null,
  }
}

function segment(overrides: Partial<RouteSegment>): RouteSegment {
  return {
    zone: 'transit',
    asn: null,
    name: null,
    firstHop: 1,
    lastHop: 1,
    hops: 1,
    silentHops: 0,
    addedMs: 1,
    status: null,
    ...overrides,
  }
}

function route(overrides: Partial<OperatorRoute> = {}): OperatorRoute {
  return {
    segments: [
      segment({ zone: 'home', firstHop: 1, lastHop: 1, addedMs: 0.6 }),
      segment({
        zone: 'isp',
        asn: 15557,
        name: 'Societe Francaise Du Radiotelephone - SFR SA',
        firstHop: 2,
        lastHop: 3,
        hops: 2,
        silentHops: 1,
        addedMs: 3.7,
      }),
      segment({
        zone: 'transit',
        asn: 9002,
        name: 'RETN Limited',
        firstHop: 4,
        lastHop: 4,
        addedMs: 12.9,
      }),
    ],
    lastRespondingHop: 4,
    totalMs: 17.2,
    destinationSilent: true,
    destinationAsn: 6507,
    destinationName: 'Riot Games, Inc',
    ...overrides,
  }
}

function complete(
  targetIp: string,
  overrides: Partial<TracerouteServerIpCompleteEvent> = {}
): TracerouteServerIpCompleteEvent {
  return {
    index: 1,
    targetIp,
    success: true,
    status: 'ok',
    hops: [
      dbHop(1, '192.168.1.254', 0.6),
      dbHop(2, '10.24.0.1', 4.3),
      dbHop(3, null, null),
      dbHop(4, '87.245.233.46', 17.2),
    ],
    route: route(),
    ...overrides,
  }
}

function finish(event: TracerouteServerIpCompleteEvent) {
  act(() => {
    useTraceStore.getState().setIpComplete(event)
    useTraceStore.getState().setAllComplete({
      totalCount: 1,
      successful: event.success ? 1 : 0,
      failed: event.success ? 0 : 1,
      completedAt: '2026-10-08T20:01:00Z',
    })
  })
}

function rows(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="hop-list"] [role="row"][data-kind]')
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(getIgnoredConnectionCount).mockResolvedValue(0)
})

afterEach(() => {
  cleanup()
  act(() => {
    useTraceStore.getState().reset()
    useMonitoringStore.getState().reset()
  })
  vi.clearAllMocks()
})

describe('Trace screen', () => {
  it('shows an empty state and the manual form when nothing is traced', async () => {
    renderTrace()

    expect(await screen.findByText('No trace running')).toBeInTheDocument()
    expect(screen.getByText(/Traces start on their own when a monitored game/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'IP address or host name' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('adds the hops one by one and waits for the next reply', async () => {
    renderTrace()
    start(target(GAME_IP, 'game'))
    begin(GAME_IP)
    await screen.findByText('Game server')

    expect(screen.getByRole('status')).toHaveTextContent('Trace running')
    expect(screen.getByText('Waiting for a reply…')).toBeInTheDocument()
    expect(rows(document.body)).toHaveLength(1)

    addHops(GAME_IP, 0.6, 4.3)
    expect(rows(document.body)).toHaveLength(3)
    expect(document.querySelectorAll('[data-kind="pending"]')).toHaveLength(1)
    expect(screen.getByText('2 hops', { exact: false })).toBeInTheDocument()

    act(() => useTraceStore.getState().addHop(hop(GAME_IP, 3, 12.1)))
    expect(rows(document.body)).toHaveLength(4)
    expect(document.querySelector('[data-kind="pending"]')).toHaveTextContent('4')
  })

  it('shows a silent hop as normal, without a timeout badge', async () => {
    renderTrace()
    start(target(GAME_IP, 'game'))
    addHops(GAME_IP, 0.6, null, 17.2)

    const silent = await screen.findByText("This router doesn't answer pings, which is normal")
    expect(silent.closest('[role="row"]')).toHaveAttribute('data-kind', 'silent')
    expect(screen.queryByText(/timeout/i)).not.toBeInTheDocument()
    expect(document.querySelector('[data-status="critical"]')).toBeNull()
  })

  it('names the role of each target, game first, and queues the others', async () => {
    renderTrace()
    start(target(GAME_IP, 'game', 7220), target(VOICE_IP, 'voice', 27015))
    addHops(GAME_IP, 0.6)

    const game = (await screen.findByText(/^Game server/)).closest('section')!
    const voice = screen.getByText(/^Voice chat/).closest('section')!
    expect(game).toHaveTextContent(`${GAME_IP}, UDP 7220, In progress`)
    expect(voice).toHaveTextContent(`${VOICE_IP}, UDP 27015, Queued`)
    expect(
      within(voice).getByText('This trace starts when the previous one finishes.')
    ).toBeVisible()
    expect(screen.getByText('2 targets')).toBeInTheDocument()
  })

  it('replaces the live hops with the route and the status computed by the backend', async () => {
    renderTrace()
    start(target(GAME_IP, 'game'))
    addHops(GAME_IP, 0.6, 4.3)
    await screen.findByText('Game server')

    finish(complete(GAME_IP, { status: 'degraded' }))

    const strip = await screen.findByRole('list', { name: 'Route by operator' })
    expect(within(strip).getByText('SFR')).toBeInTheDocument()
    expect(within(strip).getByText('RETN')).toBeInTheDocument()
    const panel = strip.closest('section')!
    expect(within(panel).getByText('Degraded')).toBeInTheDocument()
    expect(panel).toHaveTextContent(`Game server, Riot Games`)
    expect(panel).toHaveTextContent('4 hops')
    expect(document.querySelector('[data-kind="pending"]')).toBeNull()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
  })

  it('reads a silent destination as at least the last router that answers', async () => {
    renderTrace()
    start(target(GAME_IP, 'game'))
    finish(complete(GAME_IP))

    await screen.findByRole('list', { name: 'Route by operator' })

    expect(document.querySelector('[data-slot="route-total"]')).toHaveTextContent('≥ 17 ms')
    expect(document.querySelector('[data-slot="route-total"]')).toHaveTextContent(
      'up to the last responding router'
    )
    const destination = document.querySelector('[data-kind="destination-silent"]')
    expect(destination).toHaveTextContent("Riot GamesDoesn't answer pings")
    expect(destination).toHaveTextContent('Measured up to hop 4 (RETN).')
  })

  it('shows a destination that answers as a measured round trip', async () => {
    renderTrace()
    start(target(GAME_IP, 'game'))
    finish(
      complete(GAME_IP, {
        hops: [dbHop(1, '192.168.1.254', 0.6), dbHop(2, GAME_IP, 12.4)],
        route: route({
          segments: [segment({ zone: 'service', firstHop: 1, lastHop: 2, hops: 2 })],
          lastRespondingHop: 2,
          totalMs: 12.4,
          destinationSilent: false,
        }),
      })
    )

    await screen.findByRole('list', { name: 'Route by operator' })
    expect(document.querySelector('[data-slot="route-total"]')).toHaveTextContent('12 ms')
    expect(document.querySelector('[data-slot="route-total"]')).toHaveTextContent('round trip')
    expect(document.querySelector('[data-kind="destination"]')).toBeInTheDocument()
    expect(document.querySelector('[data-kind="destination-silent"]')).toBeNull()
  })

  it('says so when no router answered', async () => {
    renderTrace()
    start(target(GAME_IP, 'game'))
    finish(complete(GAME_IP, { success: false, status: 'unmeasured', hops: [], route: null }))

    expect(await screen.findByText('No router replied to this trace.')).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`${GAME_IP}, UDP 7220, No reply`))).toBeInTheDocument()
    expect(document.querySelector('[data-slot="status-pill"]')).toBeNull()
  })

  it('counts the connections that are not traced during a session', async () => {
    vi.mocked(getIgnoredConnectionCount).mockResolvedValue(34)
    act(() => {
      useMonitoringStore.getState().setStatus({
        isMonitoring: true,
        currentGame: null,
        isManualMode: false,
        currentSessionId: 12,
      })
    })
    renderTrace()

    expect(await screen.findByText('34 ignored connections')).toBeInTheDocument()
    expect(getIgnoredConnectionCount).toHaveBeenCalledWith(12)
  })

  it('does not show an ignored count outside a session', async () => {
    renderTrace()
    await screen.findByText('No trace running')

    expect(getIgnoredConnectionCount).not.toHaveBeenCalled()
    expect(screen.queryByText('Ignored connections')).not.toBeInTheDocument()
  })

  it('cancels the running trace and clears the screen', async () => {
    vi.mocked(cancelTraceroute).mockResolvedValue()
    renderTrace()
    start(target(GAME_IP, 'game'))

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(useTraceStore.getState().serverIps).toEqual([]))
    expect(cancelTraceroute).toHaveBeenCalledOnce()
    expect(await screen.findByText('No trace running')).toBeInTheDocument()
  })
})

describe('Manual trace', () => {
  async function submit(value: string) {
    const input = await screen.findByRole('textbox', { name: 'IP address or host name' })
    await userEvent.clear(input)
    if (value) await userEvent.type(input, value)
    await userEvent.click(screen.getByRole('button', { name: 'Start trace' }))
    return input
  }

  it('refuses an invalid address with a valid example and does not call the backend', async () => {
    renderTrace()

    const input = await submit('not an address')

    expect(
      await screen.findByText(
        'Invalid address. Enter an IP address or a host name, for example 162.249.72.1 or example.com.'
      )
    ).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(traceAddress).not.toHaveBeenCalled()
  })

  it('refuses an empty address', async () => {
    renderTrace()

    await submit('')

    expect(await screen.findByText(/^Invalid address\./)).toBeInTheDocument()
    expect(traceAddress).not.toHaveBeenCalled()
  })

  it('starts the trace for a valid address and empties the field', async () => {
    vi.mocked(traceAddress).mockResolvedValue('162.249.72.1')
    renderTrace()

    const input = await submit('  162.249.72.1 ')

    await waitFor(() => expect(traceAddress).toHaveBeenCalledWith('162.249.72.1'))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(screen.queryByText(/^Invalid address\./)).not.toBeInTheDocument()
  })

  it('shows a trace entered by hand as an entered address, never as a game server', async () => {
    renderTrace()
    start(target('162.249.72.1', null))
    addHops('162.249.72.1', 0.6)

    const panel = (await screen.findByText(/^Entered address/)).closest('section')!
    expect(panel).toHaveTextContent('162.249.72.1, In progress')
    expect(screen.queryByText('Game server')).not.toBeInTheDocument()
  })

  it('explains a host name that does not resolve', async () => {
    vi.mocked(traceAddress).mockRejectedValue({
      code: 'UNRESOLVED_ADDRESS',
      message: 'the host name does not resolve',
    })
    renderTrace()

    await submit('nowhere.example.com')

    expect(
      await screen.findByText(
        'This host name does not match any address. Check the spelling or enter the IP address.'
      )
    ).toBeInTheDocument()
  })

  it('keeps the address and reports an unexpected failure', async () => {
    vi.mocked(traceAddress).mockRejectedValue({ code: 'INTERNAL_ERROR', message: 'boom' })
    renderTrace()

    const input = await submit('8.8.8.8')

    await waitFor(() => expect(traceAddress).toHaveBeenCalled())
    expect(input).toHaveValue('8.8.8.8')
  })
})

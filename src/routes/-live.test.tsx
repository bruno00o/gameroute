import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'

import type {
  GamePingSample,
  LiveProbeSample,
  LiveProbeState,
  LiveStatus,
  SessionDetail,
} from '@/types/backend'
import {
  checkCaptureServiceStatus,
  getLiveProbeState,
  getLiveStatus,
  getIgnoredConnectionCount,
  getMatchIncidents,
  getSessionDetail,
  getSessionMatches,
  getSeverityThresholds,
  getUsualRoute,
  onGamePingSample,
  onLiveProbeSample,
  onLiveStatus,
  restartCaptureService,
} from '@/lib/tauri'
import { useLiveSamples } from '@/hooks/use-live-samples'
import { useLiveStore } from '@/stores/live-store'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { riotRoute, sessionMatches, thresholds, trace } from '@/test/session-fixtures'
import {
  atMatch,
  gameReading,
  homeFault,
  incident,
  liveStatus,
  MATCH_START,
  probeSample,
  SERVER,
  transitFault,
  waitingStatus,
} from '@/test/live-fixtures'
import { Route as LiveScreen } from './live'

vi.mock('@/lib/tauri', () => ({
  checkCaptureServiceStatus: vi.fn(),
  getLiveProbeState: vi.fn(),
  getLiveStatus: vi.fn(),
  getMatchIncidents: vi.fn(),
  getIgnoredConnectionCount: vi.fn(),
  getSessionDetail: vi.fn(),
  getSessionMatches: vi.fn(),
  getSeverityThresholds: vi.fn(),
  getUsualRoute: vi.fn(),
  onGamePingSample: vi.fn(),
  onLiveProbeSample: vi.fn(),
  onLiveStatus: vi.fn(),
  restartCaptureService: vi.fn(),
  resolveAsn: vi.fn(() => Promise.resolve([])),
}))

const rootRoute = createRootRoute()
const liveRoute = LiveScreen.update({
  id: '/live',
  path: '/live',
  getParentRoute: () => rootRoute,
} as never)

function Page() {
  useLiveSamples()
  return null
}

function renderLive() {
  const router = createRouter({
    routeTree: rootRoute.addChildren([liveRoute]),
    history: createMemoryHistory({ initialEntries: ['/live'] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Page />
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

function sessionDetail(): SessionDetail {
  const matches = sessionMatches()
  return {
    id: 7,
    gameName: 'VALORANT',
    startedAt: matches[0].startedAt,
    endedAt: null,
    ipPeriods: [],
    ipSummaries: [],
    traceroutes: [trace(11, SERVER, MATCH_START, riotRoute())],
  }
}

const player = {
  gameName: 'VALORANT',
  pid: 1,
  detectedAt: MATCH_START,
  exePath: null,
  icon: null,
  isManual: false,
}

type Listeners = {
  status?: (status: LiveStatus | null) => void
  probe?: (sample: LiveProbeSample) => void
  game?: (sample: GamePingSample) => void
}
const listeners: Listeners = {}

const noProbes: LiveProbeState = {
  sessionId: null,
  packetsSent: 0,
  floor: null,
  region: null,
  gateway: null,
  ispEdge: null,
}

beforeEach(() => {
  useLiveStore.getState().reset()
  useMonitoringStore.getState().reset()
  Object.keys(listeners).forEach(key => delete listeners[key as keyof Listeners])
  vi.mocked(onLiveStatus).mockImplementation(cb => {
    listeners.status = cb
    return Promise.resolve(() => {})
  })
  vi.mocked(onLiveProbeSample).mockImplementation(cb => {
    listeners.probe = cb
    return Promise.resolve(() => {})
  })
  vi.mocked(onGamePingSample).mockImplementation(cb => {
    listeners.game = cb
    return Promise.resolve(() => {})
  })
  vi.mocked(getLiveStatus).mockResolvedValue(null)
  vi.mocked(getLiveProbeState).mockResolvedValue(noProbes)
  vi.mocked(getMatchIncidents).mockResolvedValue([])
  vi.mocked(getIgnoredConnectionCount).mockResolvedValue(0)
  vi.mocked(getSessionDetail).mockResolvedValue(sessionDetail())
  vi.mocked(getSessionMatches).mockResolvedValue([])
  vi.mocked(getSeverityThresholds).mockResolvedValue(thresholds())
  vi.mocked(getUsualRoute).mockResolvedValue([])
  vi.mocked(checkCaptureServiceStatus).mockResolvedValue({
    running: true,
  } as Awaited<ReturnType<typeof checkCaptureServiceStatus>>)
  vi.mocked(restartCaptureService).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const emit = (status: LiveStatus | null) => act(() => listeners.status?.(status))
const monitor = () =>
  useMonitoringStore.setState({ isMonitoring: true, currentGame: player, currentSessionId: 7 })

describe('Live screen', () => {
  it('says nothing is monitored when no game is open', async () => {
    renderLive()

    expect(await screen.findByText('No game is being monitored')).toBeInTheDocument()
  })

  it('waits for the match with a compact screen once the game is detected', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(waitingStatus())

    expect(await screen.findByRole('heading', { name: 'Waiting for the match' })).toBeVisible()
    expect(screen.getByText('VALORANT detected')).toBeInTheDocument()
    expect(document.querySelector('[data-slot=live-readout]')).toBeNull()
    expect(document.querySelector('[data-slot=live-badge]')).toBeNull()
  })

  it('offers the usual route and the matches already played while waiting', async () => {
    monitor()
    vi.mocked(getSessionMatches).mockResolvedValue(sessionMatches())
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(waitingStatus())

    expect(await screen.findByText('Match 1')).toBeInTheDocument()
    expect(screen.getByText('Match 2')).toBeInTheDocument()
  })

  it('shows the first measure as pending while the match is measured', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus({ state: 'measuring', status: 'unmeasured', primary: null, zones: [] }))

    const readout = await screen.findByText('First measurement in a few seconds.')
    expect(readout).toBeInTheDocument()
    expect(document.querySelector('[data-slot=live-value]')).toHaveTextContent('—')
  })

  it('never shows a lower bound as the server ping', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus())

    await waitFor(() =>
      expect(document.querySelector('[data-slot=live-value]')).toHaveTextContent('≥ 18')
    )
    expect(document.querySelector('[data-slot=live-basis]')).toHaveTextContent(
      'measured up to hop 8 (RETN)'
    )
    expect(document.querySelector('[data-slot=live-reference]')).toHaveTextContent('usual ≥ 17 ms')
  })

  it('shows the game ping as measured by the game, without a bound', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus({ primary: gameReading() }))

    await waitFor(() =>
      expect(document.querySelector('[data-slot=live-value]')).toHaveTextContent(/^31$/)
    )
    expect(document.querySelector('[data-slot=live-basis]')).toHaveTextContent(
      'measured by the game'
    )
  })

  it('shows the region estimate as context only', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(
      liveStatus({
        region: {
          region: 'eu-west-3',
          provider: 'gamelift',
          host: 'dynamodb.eu-west-3.amazonaws.com',
          medianMs: 23,
          sent: 30,
          received: 30,
        },
      })
    )

    const estimate = await screen.findByText(/Closest region estimate/)
    expect(estimate).toHaveTextContent('23 ms (eu-west-3)')
    expect(document.querySelector('[data-slot=live-value]')).not.toHaveTextContent('23')
  })

  it('keeps the last values with their age when the signal freezes', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(
      liveStatus({
        state: 'frozen',
        frozenReason: 'no_samples',
        lastSampleAt: atMatch(594),
        updatedAt: atMatch(600),
      })
    )

    await waitFor(() =>
      expect(document.querySelector('[data-slot=live-readout]')).toHaveAttribute(
        'data-state',
        'frozen'
      )
    )
    expect(document.querySelector('[data-slot=live-value]')).toHaveTextContent('≥ 18')
    const readout = document.querySelector<HTMLElement>('[data-slot=live-readout]')!
    expect(within(readout).getByText('Signal frozen · 6 s ago')).toBeInTheDocument()
    expect(screen.getByText('No new measurement for 6 s')).toBeInTheDocument()
    expect(within(readout).getByText('Not measurable')).toBeInTheDocument()
  })

  it('offers to restart the capture service when it is the cause', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus({ state: 'frozen', frozenReason: 'capture_service' }))

    expect(await screen.findByText('The capture service is not responding')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart service' })).toBeInTheDocument()
  })

  it('leaves the service banner alone when the health check already shows one', async () => {
    monitor()
    vi.mocked(checkCaptureServiceStatus).mockResolvedValue({
      running: false,
    } as Awaited<ReturnType<typeof checkCaptureServiceStatus>>)
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus({ state: 'frozen', frozenReason: 'capture_service' }))

    await screen.findByText('Signal frozen · 0 s ago')
    await waitFor(() =>
      expect(screen.queryByText('The capture service is not responding')).not.toBeInTheDocument()
    )
  })

  it('draws the route of the live server from its trace', async () => {
    monitor()
    vi.mocked(getSessionMatches).mockResolvedValue(sessionMatches())
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus())

    expect(await screen.findByRole('list', { name: 'Route by operator' })).toBeInTheDocument()
  })
})

describe('Reopening mid-match', () => {
  it('shows the running match from get_live_status without waiting for an event', async () => {
    monitor()
    vi.mocked(getLiveStatus).mockResolvedValue(liveStatus())
    renderLive()

    await waitFor(() =>
      expect(document.querySelector('[data-slot=live-value]')).toHaveTextContent('≥ 18')
    )
    expect(screen.queryByText('Waiting for the match')).not.toBeInTheDocument()
  })

  it('redraws the last minute of the curve from the probe state', async () => {
    monitor()
    vi.mocked(getLiveStatus).mockResolvedValue(liveStatus())
    const samples = [570, 580, 590].map(second => probeSample({ second }))
    vi.mocked(getLiveProbeState).mockResolvedValue({
      ...noProbes,
      sessionId: 7,
      floor: {
        target: samples[0],
        samples,
        stats: { sent: 3, received: 3, lossPct: 0, medianMs: 18, jitterMs: 1 },
      },
    })
    renderLive()

    await waitFor(() =>
      expect(document.querySelector('[data-slot=spark-line]')?.getAttribute('d')).toMatch(/^M/)
    )
  })
})

describe('Live samples', () => {
  it('moves the curve on every probe sample', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.probe).toBeDefined())
    emit(liveStatus())
    await screen.findByText('measured up to hop 8 (RETN)', { selector: '[data-slot=live-basis]' })

    act(() => listeners.probe?.(probeSample({ second: 598, rttMs: 18 })))
    act(() => listeners.probe?.(probeSample({ second: 599, rttMs: 21 })))

    await waitFor(() => expect(document.querySelectorAll('[data-slot=spark-last]')).toHaveLength(1))
    expect(useLiveStore.getState().series.floor.map(point => point.v)).toEqual([18, 21])
    expect(useLiveStore.getState().beat).toBe(2)
  })
})

const slot = (name: string) => document.querySelector<HTMLElement>(`[data-slot=${name}]`)
const plain = (text: string | null | undefined) => text?.replace(/\u00a0/g, ' ')

describe('Live verdict', () => {
  it('states the figures of a healthy match in the verdict title', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus())

    const title = await screen.findByRole('heading', { name: /against .* usually, 0% loss/ })
    expect(plain(title.textContent)).toBe('≥ 18 ms against ≥ 17 ms usually, 0% loss')
    expect(slot('verdict')).toHaveAttribute('data-status', 'ok')
    expect(slot('live-advice')).toBeNull()
  })

  it('locates a loss on the transit, with the time it started and what to do', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus(transitFault()))

    expect(
      await screen.findByRole('heading', { name: '4% loss at RETN since 5:00, not at your end' })
    ).toBeVisible()
    const verdict = slot('verdict')!
    expect(verdict).toHaveAttribute('data-status', 'degraded')
    expect(verdict.querySelector('[data-zone=transit]')).toHaveAttribute('aria-current', 'true')
    expect(verdict.querySelector('[data-zone=home]')).not.toHaveAttribute('aria-current')
    expect(within(slot('live-advice')!).getByText(/network are not involved/)).toBeVisible()
  })

  it('hides the rest of the route behind the box when it loses packets', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus(homeFault()))

    expect(await screen.findByRole('heading', { name: '3% loss at home since 3:10' })).toBeVisible()
    const verdict = slot('verdict')!
    for (const zone of ['isp', 'transit', 'service']) {
      expect(
        within(verdict.querySelector<HTMLElement>(`[data-zone=${zone}]`)!).getByText(
          'Hidden by the router'
        )
      ).toBeVisible()
    }
    expect(screen.getByText(/nothing can be said about the rest of the route/)).toBeVisible()
    expect(slot('live-points')!.querySelectorAll('[data-kind=masked]')).toHaveLength(3)
  })

  it('stops rating the match once the signal is frozen', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus({ ...transitFault(), state: 'frozen', frozenReason: 'no_samples' }))

    await screen.findByText(/No new measurement for/)
    expect(slot('verdict')).toBeNull()
    expect(slot('live-points')!.querySelector('[data-point=floor]')).toHaveAttribute(
      'data-status',
      'unmeasured'
    )
  })
})

describe('Live points and flows', () => {
  it('shows the measured points, not a curve per hop', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus(transitFault()))

    const points = await waitFor(() => {
      const found = slot('live-points')
      expect(found).not.toBeNull()
      return found!
    })
    expect(
      [...points.querySelectorAll('tbody tr')].map(row => row.getAttribute('data-point'))
    ).toEqual(['gateway', 'floor'])
    expect(points.textContent).toContain('Last router that answers · hop 8 · RETN')
    expect(plain(points.textContent)).toContain('≥ 38 ms')
    expect(points.querySelector('[data-slot=sparkline]')).toBeNull()
    expect(document.querySelectorAll('[data-slot=sparkline]')).toHaveLength(1)
  })

  it('lists the game and voice flows and the ignored launcher connections', async () => {
    monitor()
    vi.mocked(getSessionMatches).mockResolvedValue(
      sessionMatches().map(match =>
        match.number === 1 ? { ...match, startedAt: MATCH_START } : match
      )
    )
    vi.mocked(getIgnoredConnectionCount).mockResolvedValue(34)
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus())

    expect(await screen.findByText(/34 web connections from the launcher ignored/)).toBeVisible()
    const flows = slot('live-flows')!
    expect(within(flows).getByText('Game server')).toBeVisible()
    expect(within(flows).getByText('Team and group voice')).toBeVisible()
    expect(plain(flows.textContent)).toContain('≥ 18 ms')
    expect(getIgnoredConnectionCount).toHaveBeenCalledWith(7)
  })

  it('keeps the flows free of an empty ignored line', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus())

    await screen.findByText('Game server')
    expect(slot('live-ignored')).toBeNull()
  })
})

describe('Live timeline', () => {
  it('draws one cell per 30 seconds and the incidents of this match', async () => {
    monitor()
    vi.mocked(getMatchIncidents).mockResolvedValue([incident()])
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus(transitFault()))

    expect(await screen.findByText('1 incident in 10:00')).toBeVisible()
    const timeline = slot('match-timeline')!
    const cells = [...timeline.querySelectorAll('[data-slot=timeline-cell]')]
    expect(cells).toHaveLength(20)
    expect(cells.map(cell => cell.getAttribute('data-status')).slice(8, 14)).toEqual([
      'ok',
      'ok',
      'degraded',
      'degraded',
      'ok',
      'ok',
    ])
    expect(within(timeline).getByText('5:00 – 6:00')).toBeVisible()
    expect(within(timeline).getByText('4% loss at RETN')).toBeVisible()
    expect(within(timeline).getByText('now · 10:00')).toBeVisible()
    expect(getMatchIncidents).toHaveBeenCalledWith(7)
  })

  it('says nothing happened when there is no incident', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus())

    expect(await screen.findByText('No incident in 10:00')).toBeVisible()
  })

  it('shows no timeline while the first measure is pending', async () => {
    monitor()
    renderLive()
    await waitFor(() => expect(listeners.status).toBeDefined())
    emit(liveStatus({ state: 'measuring', status: 'unmeasured', primary: null, zones: [] }))

    await screen.findByText('First measurement in a few seconds.')
    expect(slot('match-timeline')).toBeNull()
    expect(slot('verdict')).toBeNull()
    expect(getMatchIncidents).not.toHaveBeenCalled()
  })
})

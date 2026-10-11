import { afterEach, describe, expect, it } from 'vitest'
import { useTraceStore } from './trace-store'
import type {
  DbHop,
  OperatorRoute,
  TracedTarget,
  TracerouteAllCompleteEvent,
  TracerouteHopEvent,
  TracerouteProgressEvent,
  TracerouteServerIpCompleteEvent,
  TracerouteStartedEvent,
} from '@/types/backend'

const { getState } = useTraceStore

afterEach(() => {
  getState().reset()
})

function target(ip: string, kind: TracedTarget['kind'] = 'game'): TracedTarget {
  return { ip, kind, protocol: 'UDP', port: 7220 }
}

function started(ips: string[], startedAt = '2026-01-31T10:00:00Z'): TracerouteStartedEvent {
  return {
    serverIpCount: ips.length,
    serverIps: ips,
    targets: ips.map(ip => target(ip)),
    startedAt,
  }
}

function hopEvent(
  targetIp: string,
  hopNumber: number,
  rttMs: number | null = 1.5,
  overrides: Partial<TracerouteHopEvent> = {}
): TracerouteHopEvent {
  return {
    serverIpIndex: 1,
    targetIp,
    hopNumber,
    ip: rttMs == null ? null : `10.0.0.${hopNumber}`,
    hostname: null,
    rttMs,
    rttMin: rttMs,
    rttMax: rttMs,
    packetLoss: rttMs == null ? 100 : 0,
    timeout: rttMs == null,
    ...overrides,
  }
}

function dbHop(hopNumber: number): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 0,
    hopNumber,
    ip: `10.0.0.${hopNumber}`,
    hostname: null,
    latencyMin: 1,
    latencyAvg: 1,
    latencyMax: 1,
    packetLoss: 0,
    isProblemHop: false,
    source: 'ICMP',
    lossStatus: null,
  }
}

function completed(
  targetIp: string,
  overrides: Partial<TracerouteServerIpCompleteEvent> = {}
): TracerouteServerIpCompleteEvent {
  return {
    index: 1,
    targetIp,
    success: true,
    status: 'ok',
    hops: [dbHop(1)],
    route: null,
    ...overrides,
  }
}

describe('trace-store initial state', () => {
  it('starts idle', () => {
    const state = getState()
    expect(state.isRunning).toBe(false)
    expect(state.progress).toBeNull()
    expect(state.serverIps).toEqual([])
    expect(state.startedAt).toBeNull()
    expect(state.summary).toBeNull()
    expect(state.liveHops.size).toBe(0)
    expect(state.targets.size).toBe(0)
    expect(state.results.size).toBe(0)
  })
})

describe('setStarted', () => {
  it('initializes traceroute state with the role of each target', () => {
    getState().setStarted({
      serverIpCount: 2,
      serverIps: ['1.1.1.1', '8.8.8.8'],
      targets: [target('1.1.1.1', 'game'), target('8.8.8.8', null)],
      startedAt: '2026-01-31T10:00:00Z',
    })
    const state = getState()

    expect(state.isRunning).toBe(true)
    expect(state.serverIps).toEqual(['1.1.1.1', '8.8.8.8'])
    expect(state.targets.get('1.1.1.1')?.kind).toBe('game')
    expect(state.targets.get('8.8.8.8')?.kind).toBeNull()
    expect(state.startedAt).toBe('2026-01-31T10:00:00Z')
    expect(state.progress).toBeNull()
    expect(state.liveHops.size).toBe(0)
    expect(state.results.size).toBe(0)
    expect(state.summary).toBeNull()
  })

  it('clears previous state on a new start after completion', () => {
    getState().setStarted(started(['1.1.1.1']))
    getState().addHop(hopEvent('1.1.1.1', 1))
    getState().setIpComplete(completed('1.1.1.1'))
    getState().setAllComplete({
      totalCount: 1,
      successful: 1,
      failed: 0,
      completedAt: '2026-01-31T10:01:00Z',
    })

    getState().setStarted(started(['2.2.2.2'], '2026-01-31T11:00:00Z'))

    expect(getState().serverIps).toEqual(['2.2.2.2'])
    expect(getState().liveHops.size).toBe(0)
    expect(getState().results.size).toBe(0)
    expect(getState().summary).toBeNull()
  })

  it('merges targets added while running', () => {
    getState().setStarted(started(['162.249.72.5']))
    getState().addHop(hopEvent('162.249.72.5', 1, 0.5))

    getState().setStarted({
      serverIpCount: 2,
      serverIps: ['185.40.64.1', '162.249.72.5'],
      targets: [target('185.40.64.1', 'voice'), target('162.249.72.5')],
      startedAt: '2026-01-31T10:20:00Z',
    })

    const state = getState()
    expect(state.isRunning).toBe(true)
    expect(state.serverIps).toEqual(['162.249.72.5', '185.40.64.1'])
    expect(state.targets.get('185.40.64.1')?.kind).toBe('voice')
    expect(state.startedAt).toBe('2026-01-31T10:00:00Z')
    expect(state.liveHops.get('162.249.72.5')).toHaveLength(1)
  })

  it('starts over a target that is traced again while running', () => {
    getState().setStarted(started(['1.1.1.1', '2.2.2.2']))
    getState().addHop(hopEvent('1.1.1.1', 1))
    getState().setIpComplete(completed('1.1.1.1'))

    getState().setStarted(started(['1.1.1.1']))

    expect(getState().results.has('1.1.1.1')).toBe(false)
    expect(getState().liveHops.has('1.1.1.1')).toBe(false)
    expect(getState().serverIps).toEqual(['1.1.1.1', '2.2.2.2'])
  })
})

describe('addHop', () => {
  it('adds hops one by one, grouped by target IP and ordered by hop number', () => {
    getState().addHop(hopEvent('1.1.1.1', 1))
    getState().addHop(hopEvent('1.1.1.1', 3, 5))
    getState().addHop(hopEvent('1.1.1.1', 2, null))

    const hops = getState().liveHops.get('1.1.1.1')
    expect(hops?.map(hop => hop.hopNumber)).toEqual([1, 2, 3])
    expect(hops?.[1].timeout).toBe(true)
  })

  it('replaces a hop that is reported again', () => {
    getState().addHop(hopEvent('1.1.1.1', 1, 1))
    getState().addHop(hopEvent('1.1.1.1', 1, 2))

    const hops = getState().liveHops.get('1.1.1.1')
    expect(hops).toHaveLength(1)
    expect(hops?.[0].rttMs).toBe(2)
  })

  it('keeps hops separate per IP', () => {
    getState().addHop(hopEvent('1.1.1.1', 1))
    getState().addHop(hopEvent('8.8.8.8', 1))

    expect(getState().liveHops.get('1.1.1.1')).toHaveLength(1)
    expect(getState().liveHops.get('8.8.8.8')).toHaveLength(1)
  })
})

describe('setProgress', () => {
  it('updates progress', () => {
    const progress: TracerouteProgressEvent = {
      currentIp: '1.1.1.1',
      currentIndex: 0,
      totalCount: 3,
      progress: 33,
    }

    getState().setProgress(progress)
    expect(getState().progress).toEqual(progress)
  })

  it('can clear progress', () => {
    getState().setProgress({
      currentIp: '1.1.1.1',
      currentIndex: 0,
      totalCount: 1,
      progress: 100,
    })
    getState().setProgress(null)
    expect(getState().progress).toBeNull()
  })
})

describe('setIpComplete', () => {
  const route: OperatorRoute = {
    segments: [],
    lastRespondingHop: 1,
    totalMs: 1,
    destinationSilent: false,
    destinationAsn: null,
    destinationName: 'Riot Games, Inc',
  }

  it('keeps the status, the final hops and the route computed by the backend', () => {
    getState().setIpComplete(completed('1.1.1.1', { status: 'degraded', route }))

    const result = getState().results.get('1.1.1.1')
    expect(result?.success).toBe(true)
    expect(result?.status).toBe('degraded')
    expect(result?.hops).toHaveLength(1)
    expect(result?.route).toEqual(route)
  })

  it('marks IP as failed', () => {
    getState().setIpComplete(
      completed('8.8.8.8', { success: false, status: 'unmeasured', hops: [] })
    )

    expect(getState().results.get('8.8.8.8')).toMatchObject({
      success: false,
      status: 'unmeasured',
      hops: [],
    })
  })

  it('accumulates multiple IPs', () => {
    getState().setIpComplete(completed('1.1.1.1'))
    getState().setIpComplete(completed('8.8.8.8', { success: false, status: 'unmeasured' }))

    expect(getState().results.size).toBe(2)
  })
})

describe('setAllComplete', () => {
  it('sets summary and stops running when running', () => {
    getState().setRunning(true)

    const event: TracerouteAllCompleteEvent = {
      totalCount: 3,
      successful: 2,
      failed: 1,
      completedAt: '2026-01-31T10:05:00Z',
    }

    getState().setAllComplete(event)

    expect(getState().isRunning).toBe(false)
    expect(getState().summary).toEqual(event)
  })

  it('ignores stale event when not running (cancelled)', () => {
    expect(getState().isRunning).toBe(false)

    getState().setAllComplete({
      totalCount: 0,
      successful: 0,
      failed: 0,
      completedAt: '2026-01-31T10:05:00Z',
    })

    expect(getState().summary).toBeNull()
  })
})

describe('reset', () => {
  it('clears all state', () => {
    getState().setStarted(started(['1.1.1.1']))
    getState().addHop(hopEvent('1.1.1.1', 1))
    getState().setIpComplete(completed('1.1.1.1'))

    getState().reset()

    const state = getState()
    expect(state.isRunning).toBe(false)
    expect(state.progress).toBeNull()
    expect(state.serverIps).toEqual([])
    expect(state.targets.size).toBe(0)
    expect(state.startedAt).toBeNull()
    expect(state.liveHops.size).toBe(0)
    expect(state.results.size).toBe(0)
    expect(state.summary).toBeNull()
  })
})

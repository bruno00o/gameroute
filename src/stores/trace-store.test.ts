import { afterEach, describe, expect, it } from 'vitest'
import { useTraceStore } from './trace-store'
import type {
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

describe('trace-store initial state', () => {
  it('starts idle', () => {
    const state = getState()
    expect(state.isRunning).toBe(false)
    expect(state.progress).toBeNull()
    expect(state.serverIps).toEqual([])
    expect(state.startedAt).toBeNull()
    expect(state.summary).toBeNull()
    expect(state.liveHops.size).toBe(0)
    expect(state.completedIps.size).toBe(0)
  })
})

describe('setStarted', () => {
  it('initializes traceroute state', () => {
    const event: TracerouteStartedEvent = {
      serverIpCount: 2,
      serverIps: ['1.1.1.1', '8.8.8.8'],
      startedAt: '2026-01-31T10:00:00Z',
    }

    getState().setStarted(event)
    const state = getState()

    expect(state.isRunning).toBe(true)
    expect(state.serverIps).toEqual(['1.1.1.1', '8.8.8.8'])
    expect(state.startedAt).toBe('2026-01-31T10:00:00Z')
    expect(state.progress).toBeNull()
    expect(state.liveHops.size).toBe(0)
    expect(state.completedIps.size).toBe(0)
    expect(state.summary).toBeNull()
  })

  it('clears previous state on a new start after completion', () => {
    getState().setStarted({
      serverIpCount: 1,
      serverIps: ['1.1.1.1'],
      startedAt: '2026-01-31T10:00:00Z',
    })
    getState().addHop({
      serverIpIndex: 1,
      targetIp: '1.1.1.1',
      hopNumber: 1,
      ip: '192.168.1.1',
      hostname: null,
      rttMs: 1.5,
      timeout: false,
    })
    getState().setAllComplete({
      totalCount: 1,
      successful: 1,
      failed: 0,
      completedAt: '2026-01-31T10:01:00Z',
    })

    getState().setStarted({
      serverIpCount: 1,
      serverIps: ['2.2.2.2'],
      startedAt: '2026-01-31T11:00:00Z',
    })

    expect(getState().serverIps).toEqual(['2.2.2.2'])
    expect(getState().liveHops.size).toBe(0)
    expect(getState().summary).toBeNull()
  })

  it('merges targets added while running', () => {
    getState().setStarted({
      serverIpCount: 1,
      serverIps: ['162.249.72.5'],
      startedAt: '2026-01-31T10:00:00Z',
    })
    getState().addHop({
      serverIpIndex: 1,
      targetIp: '162.249.72.5',
      hopNumber: 1,
      ip: '192.168.1.1',
      hostname: null,
      rttMs: 0.5,
      timeout: false,
    })

    getState().setStarted({
      serverIpCount: 2,
      serverIps: ['185.40.64.1', '162.249.72.5'],
      startedAt: '2026-01-31T10:20:00Z',
    })

    const state = getState()
    expect(state.isRunning).toBe(true)
    expect(state.serverIps).toEqual(['162.249.72.5', '185.40.64.1'])
    expect(state.startedAt).toBe('2026-01-31T10:00:00Z')
    expect(state.liveHops.get('162.249.72.5')).toHaveLength(1)
  })
})

describe('addHop', () => {
  it('adds hops grouped by target IP', () => {
    const hop1: TracerouteHopEvent = {
      serverIpIndex: 1,
      targetIp: '1.1.1.1',
      hopNumber: 1,
      ip: '192.168.1.1',
      hostname: null,
      rttMs: 1.5,
      timeout: false,
    }
    const hop2: TracerouteHopEvent = {
      serverIpIndex: 1,
      targetIp: '1.1.1.1',
      hopNumber: 2,
      ip: '10.0.0.1',
      hostname: null,
      rttMs: 5.0,
      timeout: false,
    }

    getState().addHop(hop1)
    getState().addHop(hop2)

    const hops = getState().liveHops.get('1.1.1.1')
    expect(hops).toHaveLength(2)
    expect(hops![0].hopNumber).toBe(1)
    expect(hops![1].hopNumber).toBe(2)
  })

  it('keeps hops separate per IP', () => {
    getState().addHop({
      serverIpIndex: 1,
      targetIp: '1.1.1.1',
      hopNumber: 1,
      ip: '10.0.0.1',
      hostname: null,
      rttMs: 1.0,
      timeout: false,
    })
    getState().addHop({
      serverIpIndex: 2,
      targetIp: '8.8.8.8',
      hopNumber: 1,
      ip: '10.0.0.1',
      hostname: null,
      rttMs: 2.0,
      timeout: false,
    })

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
  it('marks IP as successful', () => {
    const event: TracerouteServerIpCompleteEvent = {
      index: 1,
      targetIp: '1.1.1.1',
      success: true,
      status: 'ok',
    }

    getState().setIpComplete(event)
    expect(getState().completedIps.get('1.1.1.1')).toBe(true)
    expect(getState().statuses.get('1.1.1.1')).toBe('ok')
  })

  it('marks IP as failed', () => {
    const event: TracerouteServerIpCompleteEvent = {
      index: 1,
      targetIp: '8.8.8.8',
      success: false,
      status: 'unmeasured',
    }

    getState().setIpComplete(event)
    expect(getState().completedIps.get('8.8.8.8')).toBe(false)
  })

  it('accumulates multiple IPs', () => {
    getState().setIpComplete({ index: 1, targetIp: '1.1.1.1', success: true, status: 'ok' })
    getState().setIpComplete({
      index: 2,
      targetIp: '8.8.8.8',
      success: false,
      status: 'unmeasured',
    })

    expect(getState().completedIps.size).toBe(2)
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
    // Simulate cancel: isRunning is already false
    expect(getState().isRunning).toBe(false)

    const event: TracerouteAllCompleteEvent = {
      totalCount: 0,
      successful: 0,
      failed: 0,
      completedAt: '2026-01-31T10:05:00Z',
    }

    getState().setAllComplete(event)

    expect(getState().summary).toBeNull()
  })
})

describe('reset', () => {
  it('clears all state', () => {
    getState().setStarted({
      serverIpCount: 1,
      serverIps: ['1.1.1.1'],
      startedAt: '2026-01-31T10:00:00Z',
    })
    getState().addHop({
      serverIpIndex: 1,
      targetIp: '1.1.1.1',
      hopNumber: 1,
      ip: '10.0.0.1',
      hostname: null,
      rttMs: 1.0,
      timeout: false,
    })
    getState().setIpComplete({ index: 1, targetIp: '1.1.1.1', success: true, status: 'ok' })

    getState().reset()

    const state = getState()
    expect(state.isRunning).toBe(false)
    expect(state.progress).toBeNull()
    expect(state.serverIps).toEqual([])
    expect(state.startedAt).toBeNull()
    expect(state.liveHops.size).toBe(0)
    expect(state.completedIps.size).toBe(0)
    expect(state.statuses.size).toBe(0)
    expect(state.summary).toBeNull()
  })
})

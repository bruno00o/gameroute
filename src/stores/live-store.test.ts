import { beforeEach, describe, expect, it } from 'vitest'

import type { GamePingSample, LiveProbeState, LiveTrack } from '@/types/backend'
import {
  atMatch,
  gameReading,
  liveStatus,
  probeSample,
  SERVER,
  waitingStatus,
} from '@/test/live-fixtures'
import { useLiveStore } from './live-store'

const store = () => useLiveStore.getState()

function gameSample(second: number, overrides: Partial<GamePingSample> = {}): GamePingSample {
  return {
    sessionId: 7,
    source: 'game',
    measuredAt: atMatch(second),
    peerIp: SERVER,
    peerPort: 7220,
    region: null,
    rttMs: 31,
    jitterMs: 2,
    packetsLost: 0,
    packetsSent: 5,
    ...overrides,
  }
}

function track(seconds: number[]): LiveTrack {
  const samples = seconds.map(second => probeSample({ second }))
  return {
    target: samples[0],
    samples,
    stats: {
      sent: seconds.length,
      received: seconds.length,
      lossPct: 0,
      medianMs: 18,
      jitterMs: 1,
    },
  }
}

beforeEach(() => {
  store().reset()
})

describe('live store beats', () => {
  it('does not beat when the status arrives', () => {
    store().setStatus(liveStatus())
    store().setStatus(liveStatus({ updatedAt: atMatch(601) }))
    expect(store().beat).toBe(0)
  })

  it('beats once per sample of the primary measure', () => {
    store().setStatus(liveStatus())
    store().pushProbe(probeSample({ second: 601 }))
    store().pushProbe(probeSample({ second: 602 }))
    expect(store().beat).toBe(2)
  })

  it('does not beat for the other probes while a primary measure exists', () => {
    store().setStatus(liveStatus())
    store().pushProbe(probeSample({ source: 'gateway', second: 601 }))
    store().pushProbe(probeSample({ source: 'isp_edge', second: 601 }))
    store().pushProbe(probeSample({ source: 'region', second: 601 }))
    expect(store().beat).toBe(0)
  })

  it('beats on the game ping when the game is the primary measure', () => {
    store().setStatus(liveStatus({ primary: gameReading() }))
    store().pushProbe(probeSample({ second: 601 }))
    expect(store().beat).toBe(0)
    store().pushGame(gameSample(601))
    expect(store().beat).toBe(1)
  })

  it('ignores the samples of another session or another server', () => {
    store().setStatus(liveStatus())
    store().pushProbe(probeSample({ sessionId: 9 }))
    store().pushProbe(probeSample({ serverIp: '203.0.113.9' }))
    store().pushGame(gameSample(601, { peerIp: '203.0.113.9' }))
    expect(store().beat).toBe(0)
    expect(store().series.floor).toHaveLength(0)
  })
})

describe('live store series', () => {
  it('keeps the last minute of the floor probe, with lost probes as gaps', () => {
    store().setStatus(liveStatus())
    store().pushProbe(probeSample({ second: 1, rttMs: 18 }))
    store().pushProbe(probeSample({ second: 2, rttMs: null }))
    store().pushProbe(probeSample({ second: 3, rttMs: 19 }))
    expect(store().series.floor.map(p => p.v)).toEqual([18, null, 19])

    store().pushProbe(probeSample({ second: 62, rttMs: 20 }))
    expect(store().series.floor.map(p => p.v)).toEqual([19, 20])
  })

  it('does not record a game ping that was not measured', () => {
    store().setStatus(liveStatus())
    store().pushGame(gameSample(1, { rttMs: null }))
    store().pushGame(gameSample(2, { source: 'game_region' }))
    expect(store().series.game).toHaveLength(0)
  })

  it('starts a new curve for a new match', () => {
    store().setStatus(liveStatus())
    store().pushProbe(probeSample({ second: 1 }))
    store().setStatus(liveStatus({ matchStartedAt: atMatch(900), updatedAt: atMatch(901) }))
    expect(store().series.floor).toHaveLength(0)
  })

  it('keeps the first probes that arrive before the first status of a match', () => {
    store().setStatus(waitingStatus())
    store().pushProbe(probeSample({ second: 1 }))
    store().setStatus(liveStatus({ state: 'measuring', updatedAt: atMatch(2) }))
    expect(store().series.floor).toHaveLength(1)
  })

  it('clears everything when the monitoring ends', () => {
    store().setStatus(liveStatus())
    store().pushProbe(probeSample({ second: 1 }))
    store().setStatus(null)
    expect(store().status).toBeNull()
    expect(store().series.floor).toHaveLength(0)
  })
})

describe('live store hydration', () => {
  const probes = (floor: LiveTrack | null): LiveProbeState => ({
    sessionId: 7,
    packetsSent: 40,
    floor,
    region: null,
    gateway: null,
    ispEdge: null,
  })

  it('rebuilds the status and the last minute when the window is reopened mid-match', () => {
    store().hydrate(liveStatus(), probes(track([560, 570, 580, 590])))

    expect(store().status?.state).toBe('live')
    expect(store().series.floor).toHaveLength(4)
    expect(store().beat).toBe(0)
  })

  it('does not replace a newer status with the one it read', () => {
    store().setStatus(liveStatus({ updatedAt: atMatch(605) }))
    store().hydrate(liveStatus({ updatedAt: atMatch(600), status: 'critical' }), null)
    expect(store().status?.status).toBe('ok')
  })

  it('does not mix in the probes of another session', () => {
    store().hydrate(liveStatus(), { ...probes(track([590])), sessionId: 3 })
    expect(store().series.floor).toHaveLength(0)
  })
})

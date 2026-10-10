import { describe, expect, it } from 'vitest'

import type { MatchIncident } from '@/types/backend'
import { matchEndMessage, shouldAnnounce, summarizeMatch } from './match-end'

const STARTED = '2026-10-08T20:00:00.000Z'
const NOW = Date.parse('2026-10-08T20:40:00.000Z')

function incident(overrides: Partial<MatchIncident>): MatchIncident {
  return {
    id: 1,
    sessionId: 1,
    serverIp: '162.249.72.5',
    serverPort: 7220,
    matchStartedAt: STARTED,
    startedAt: '2026-10-08T20:22:40.000Z',
    endedAt: '2026-10-08T20:28:50.000Z',
    status: 'degraded',
    cause: 'loss',
    basis: {
      source: 'game',
      atDestination: true,
      measuredHop: null,
      measuredAsn: null,
      serverIp: null,
    },
    atLeast: false,
    pingMs: 80,
    usualMs: 40,
    lossPct: 3,
    jitterMs: null,
    zone: 'transit',
    afterHop: null,
    atHop: 6,
    asn: 9002,
    operator: 'RETN',
    ...overrides,
  }
}

describe('summarizeMatch', () => {
  it('is clean when nothing went past watch', () => {
    const summary = summarizeMatch([incident({ status: 'watch' })], STARTED, NOW)

    expect(summary).toEqual({ kind: 'clean', seconds: 0, worst: null })
  })

  it('adds up the degraded time and keeps the worst incident', () => {
    const summary = summarizeMatch(
      [
        incident({ id: 1 }),
        incident({
          id: 2,
          status: 'critical',
          startedAt: '2026-10-08T20:30:00.000Z',
          endedAt: '2026-10-08T20:31:00.000Z',
        }),
        incident({ id: 3, matchStartedAt: '2026-10-08T19:00:00.000Z' }),
      ],
      STARTED,
      NOW
    )

    expect(summary.kind).toBe('critical')
    expect(summary.seconds).toBe(370 + 60)
    expect(summary.worst?.id).toBe(2)
  })

  it('counts an incident still open up to now', () => {
    const summary = summarizeMatch([incident({ endedAt: null })], STARTED, NOW)

    expect(summary.seconds).toBe(17 * 60 + 20)
  })
})

describe('shouldAnnounce', () => {
  const clean = summarizeMatch([], STARTED, NOW)
  const bad = summarizeMatch([incident({})], STARTED, NOW)

  it('follows the summary setting', () => {
    expect(shouldAnnounce('never', bad)).toBe(false)
    expect(shouldAnnounce('changed', clean)).toBe(false)
    expect(shouldAnnounce('changed', bad)).toBe(true)
    expect(shouldAnnounce('always', clean)).toBe(true)
  })
})

describe('matchEndMessage', () => {
  it('states the duration, the cause, the operator and the minutes', () => {
    const summary = summarizeMatch([incident({})], STARTED, NOW)
    const message = matchEndMessage(summary, STARTED, NOW)

    expect(message.title).toBe('Match over, degraded for 6 min 10 s')
    expect(message.description).toBe('Loss at RETN from 22:40 to 28:50. The summary is ready.')
  })

  it('names no operator when there is none', () => {
    const summary = summarizeMatch([incident({ operator: null, status: 'critical' })], STARTED, NOW)
    const message = matchEndMessage(summary, STARTED, NOW)

    expect(message.title).toContain('critical for')
    expect(message.description).toBe('Loss from 22:40 to 28:50. The summary is ready.')
  })

  it('says nothing went wrong when the setting asks for every match', () => {
    const message = matchEndMessage(summarizeMatch([], STARTED, NOW), STARTED, NOW)

    expect(message.title).toBe('Match over with no incident')
  })
})

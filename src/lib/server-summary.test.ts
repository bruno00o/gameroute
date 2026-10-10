import { describe, expect, it } from 'vitest'

import type { ServerSummaryItem } from '@/types/backend'
import { homeVerdict } from '@/lib/server-summary'

const NB = ' '

function server(overrides: Partial<ServerSummaryItem>): ServerSummaryItem {
  return {
    gameName: 'VALORANT',
    asn: 6507,
    operator: 'Riot Games, Inc.',
    city: 'Paris',
    ips: ['162.249.72.5'],
    matchCount: 2,
    lastPlayedAt: '2026-10-06T19:07:00Z',
    basis: {
      source: 'trace',
      atDestination: true,
      measuredHop: null,
      measuredAsn: null,
      serverIp: '162.249.72.5',
    },
    recent: { medianMs: 18.4, lossPct: 0, sampleCount: 2 },
    usual: { medianMs: 17.6, sampleCount: 20 },
    status: 'ok',
    lastIncident: null,
    ...overrides,
  }
}

describe('homeVerdict', () => {
  it('reads the most played server when every server is under its thresholds', () => {
    const verdict = homeVerdict(
      [
        server({}),
        server({
          gameName: 'League of Legends',
          city: 'Amsterdam',
          matchCount: 5,
          recent: { medianMs: 31.2, lossPct: 0.4, sampleCount: 5 },
          usual: { medianMs: null, sampleCount: 3 },
        }),
      ],
      7
    )!

    expect(verdict.status).toBe('ok')
    expect(verdict.title).toBe(`31${NB}ms median on League of Legends, Riot Games, 0.4% loss`)
    expect(verdict.scope).toBe('Last 7 days, 7 matches, 2 game servers')
    expect(verdict.sentences).toEqual(['None of the 2 measured servers is above a threshold.'])
  })

  it('counts the matches it could not measure when no server was measured', () => {
    const verdict = homeVerdict(
      [server({ recent: null, basis: null, status: 'unmeasured', matchCount: 3 })],
      7
    )!

    expect(verdict.status).toBe('unmeasured')
    expect(verdict.title).toBe('None of the 3 matches could be measured')
  })

  it('has nothing to say when no server was played in the window', () => {
    expect(homeVerdict([server({ recent: null, status: null, matchCount: 0 })], 7)).toBeNull()
    expect(homeVerdict([], 7)).toBeNull()
  })
})

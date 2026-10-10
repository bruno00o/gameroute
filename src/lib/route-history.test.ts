import { describe, expect, it } from 'vitest'

import type { RouteChange, RouteSegment, UsualRoute } from '@/types/backend'
import {
  changeFacts,
  changePeriod,
  changeSummary,
  hasSilentServer,
  matchesOperator,
  operatorKey,
  routeLimitNote,
  routeOperators,
} from '@/lib/route-history'

const NB = ' '

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

function usual(overrides: Partial<UsualRoute['route']> = {}, gameName = 'VALORANT'): UsualRoute {
  return {
    gameName,
    traceCount: 3,
    totalTraces: 3,
    persistentLoss: null,
    gamePing: null,
    route: {
      segments: [
        segment({ zone: 'home', firstHop: 1, lastHop: 2, hops: 2 }),
        segment({ zone: 'isp', asn: 15557, name: 'SFR SA', firstHop: 3, lastHop: 5, hops: 3 }),
        segment({ asn: 9002, name: 'RETN Limited', firstHop: 6, lastHop: 8, hops: 3 }),
      ],
      lastRespondingHop: 8,
      totalMs: 17.2,
      destinationSilent: true,
      destinationAsn: 6507,
      destinationName: 'Riot Games, Inc',
      ...overrides,
    },
    latest: {
      tracerouteId: 1,
      sessionId: 1,
      matchNumber: 1,
      startedAt: '2026-09-28T19:00:00Z',
      targetIp: '162.249.72.5',
      hops: [],
    },
  }
}

function change(overrides: Partial<RouteChange> = {}): RouteChange {
  return {
    gameName: 'VALORANT',
    startedAt: '2026-09-20T19:12:00Z',
    endedAt: '2026-09-20T19:12:00Z',
    sessionId: 9,
    matchNumber: 2,
    traceCount: 1,
    path: [{ asn: 174, name: 'Cogent Communications' }],
    via: [{ asn: 174, name: 'Cogent Communications' }],
    insteadOf: [{ asn: 9002, name: 'RETN Limited' }],
    totalMs: 20.3,
    usualTotalMs: 17.2,
    lossPct: 0,
    returned: false,
    ...overrides,
  }
}

describe('operators', () => {
  it('keys an operator by its AS number, then by its lower-cased name', () => {
    expect(operatorKey({ asn: 9002, name: 'RETN Limited' })).toBe('AS9002')
    expect(operatorKey({ asn: null, name: 'Some Carrier' })).toBe('some carrier')
    expect(operatorKey({ asn: null, name: null })).toBeNull()
  })

  it('matches a segment on the same key', () => {
    const retn = segment({ asn: 9002, name: 'RETN Limited' })
    expect(matchesOperator(retn, 'AS9002')).toBe(true)
    expect(matchesOperator(retn, 'AS174')).toBe(false)
    expect(matchesOperator(retn, undefined)).toBe(false)
  })

  it('lists each operator of each game once, without the home network', () => {
    const entries = routeOperators([usual(), usual({}, 'League of Legends')])

    expect(entries.map(entry => [entry.gameName, entry.name, entry.asn, entry.zone])).toEqual([
      ['VALORANT', 'SFR', 15557, 'isp'],
      ['VALORANT', 'RETN', 9002, 'transit'],
      ['League of Legends', 'SFR', 15557, 'isp'],
      ['League of Legends', 'RETN', 9002, 'transit'],
    ])
  })

  it('leaves out segments no operator was found for', () => {
    const route = usual({ segments: [segment({ zone: 'isp' }), segment({ zone: 'transit' })] })
    expect(routeOperators([route])).toEqual([])
  })
})

describe('routeLimitNote', () => {
  it('names the last router that answers when the destination is silent', () => {
    expect(routeLimitNote(usual())).toBe(
      'Riot Games doesn’t answer pings, which is normal. Measurement goes up to the last router that answers (hop 8, RETN); what the last stretch adds can’t be measured.'
    )
  })

  it('says nothing when the destination answers', () => {
    expect(routeLimitNote(usual({ destinationSilent: false }))).toBeNull()
  })

  it('falls back on the zone when the last operator has no name', () => {
    const route = usual({
      lastRespondingHop: 5,
      segments: [segment({ zone: 'isp', firstHop: 1, lastHop: 5 })],
    })
    expect(routeLimitNote(route)).toContain('(hop 5, Your ISP)')
  })

  it('gives the last stretch deduced from the game ping when there is one', () => {
    const route = { ...usual(), gamePing: { medianMs: 12.4, matchCount: 42, deducedMs: 7.9 } }
    expect(routeLimitNote(route)).toBe(
      'Riot Games doesn’t answer pings, which is normal. Traces stop at the last router that answers (hop 8, RETN); the last stretch, +7.9 ms, is deduced from the ping measured by the game.'
    )
  })
})

describe('hasSilentServer', () => {
  it('is true only when the route ends before the game server', () => {
    expect(hasSilentServer(usual().route)).toBe(true)
    expect(hasSilentServer(usual({ destinationSilent: false }).route)).toBe(false)
    const service = usual({
      segments: [...usual().route.segments, segment({ zone: 'service', asn: 6507 })],
    })
    expect(hasSilentServer(service.route)).toBe(false)
  })
})

describe('route changes', () => {
  it('reads another operator in place of the usual one', () => {
    expect(changeSummary(change())).toBe('Via Cogent instead of RETN')
  })

  it('reads an extra operator, a missing one and a different order', () => {
    expect(changeSummary(change({ insteadOf: [] }))).toBe('Via Cogent, on top of the usual route')
    expect(changeSummary(change({ via: [] }))).toBe('Without RETN')
    expect(
      changeSummary(
        change({
          via: [],
          insteadOf: [],
          path: [
            { asn: 9002, name: 'RETN Limited' },
            { asn: 15557, name: 'SFR SA' },
          ],
        })
      )
    ).toBe('Different order: RETN → SFR')
  })

  it('compares the total with the usual one, from the last router when the server is silent', () => {
    expect(changeFacts(change(), usual())).toBe(
      `≥${NB}20${NB}ms vs ≥${NB}17${NB}ms on the usual route · no loss`
    )
    expect(changeFacts(change(), usual({ destinationSilent: false }))).toBe(
      `20${NB}ms vs 17${NB}ms on the usual route · no loss`
    )
  })

  it('adds the number of matches, the loss and the return to the usual route', () => {
    const facts = changeFacts(change({ traceCount: 2, lossPct: 3.5, returned: true }), usual())
    expect(facts).toBe(
      `2 matches · ≥${NB}20${NB}ms vs ≥${NB}17${NB}ms on the usual route · 3.5% loss · Back on the usual route afterwards`
    )
  })

  it('shows one day or the span of days', () => {
    expect(
      changePeriod(change({ startedAt: '2026-09-20T12:00:00', endedAt: '2026-09-20T15:00:00' }))
    ).toBe('Sep 20')
    expect(
      changePeriod(change({ startedAt: '2026-09-20T12:00:00', endedAt: '2026-09-22T15:00:00' }))
    ).toBe('Sep 20 → Sep 22')
  })
})

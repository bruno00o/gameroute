import { describe, expect, it } from 'vitest'

import type { ServerIncident, ServerSummaryItem } from '@/types/backend'
import { homeVerdict, incidentWhen } from '@/lib/server-summary'

const NB = ' '
const local = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).toISOString()
const now = new Date(2026, 9, 11, 12, 0)
const since = local(4, 12)

function incident(overrides: Partial<ServerIncident> = {}): ServerIncident {
  return {
    sessionId: 12,
    matchNumber: 3,
    startedAt: local(6, 20, 50),
    measuredAt: local(6, 21, 14),
    status: 'watch',
    cause: 'latency',
    basis: {
      source: 'trace',
      atDestination: false,
      measuredHop: 9,
      measuredAsn: 15557,
      serverIp: '162.249.72.5',
    },
    pingMs: 41.6,
    usual: { medianMs: 17.2, sampleCount: 20 },
    lossPct: 0,
    ...overrides,
  }
}

function server(overrides: Partial<ServerSummaryItem>): ServerSummaryItem {
  return {
    gameName: 'VALORANT',
    asn: 6507,
    operator: 'Riot Games, Inc.',
    city: 'Paris',
    ips: ['162.249.72.5'],
    matchCount: 2,
    lastPlayedAt: local(6, 21, 7),
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

const verdictOf = (servers: ServerSummaryItem[]) => homeVerdict({ servers, since }, 7, now)

describe('homeVerdict', () => {
  it('says all is well across every game without picking one server', () => {
    const verdict = verdictOf([
      server({}),
      server({
        gameName: 'League of Legends',
        city: 'Amsterdam',
        matchCount: 5,
        recent: { medianMs: 31.2, lossPct: 0.4, sampleCount: 5 },
        usual: { medianMs: null, sampleCount: 3 },
      }),
    ])!

    expect(verdict.status).toBe('ok')
    expect(verdict.title).toBe('All good on your 2 games this week')
    expect(verdict.scope).toBe('Last 7 days, 7 matches, 2 game servers')
    expect(verdict.sentences).toEqual([])
  })

  it('names the only game when it is the only one played', () => {
    const verdict = verdictOf([
      server({}),
      server({ city: 'Frankfurt', recent: null, basis: null, status: 'unmeasured' }),
    ])!

    expect(verdict.title).toBe('All good on VALORANT this week')
    expect(verdict.sentences).toEqual(['1 server could not be measured.'])
  })

  it('names the worst game, the problem and when it happened, never chaining lower bounds', () => {
    const verdict = verdictOf([
      server({ gameName: 'Fortnite', operator: 'Amazon.com, Inc.', asn: 16509, city: 'Paris' }),
      server({
        gameName: 'League of Legends',
        basis: incident().basis,
        recent: { medianMs: 38.2, lossPct: 0, sampleCount: 4 },
        usual: { medianMs: 17.2, sampleCount: 20 },
        status: 'watch',
        lastIncident: incident(),
      }),
    ])!

    expect(verdict.status).toBe('watch')
    expect(verdict.title).toBe('League of Legends: higher ping than usual Tuesday evening')
    expect(verdict.title).not.toContain('≥')
    expect(verdict.sentences).toEqual([
      `Median this week: 38${NB}ms up to hop 9, 17${NB}ms usually.`,
      'Nothing to report on Fortnite.',
    ])
  })

  it('reports loss, names the measured operator and lists other games to watch', () => {
    const lossy = incident({ cause: 'loss', lossPct: 4, measuredAt: local(10, 22, 30) })
    const verdict = verdictOf([
      server({
        gameName: 'League of Legends',
        basis: { ...lossy.basis, measuredAsn: 6507 },
        recent: { medianMs: 21, lossPct: 3, sampleCount: 4 },
        status: 'degraded',
        lastIncident: lossy,
      }),
      server({ status: 'watch' }),
    ])!

    expect(verdict.title).toBe('League of Legends: 4% loss yesterday evening')
    expect(verdict.sentences).toEqual([
      `Median this week: 21${NB}ms up to hop 9 (Riot Games), 18${NB}ms usually, 3% loss.`,
      'Also worth watching: VALORANT.',
    ])
  })

  it('labels a ping measured by the game and ignores incidents older than the window', () => {
    const verdict = verdictOf([
      server({
        basis: { ...server({}).basis!, source: 'game' },
        recent: { medianMs: 52, lossPct: 0, sampleCount: 3 },
        usual: { medianMs: null, sampleCount: 1 },
        status: 'watch',
        lastIncident: incident({ measuredAt: local(1, 21) }),
      }),
    ])!

    expect(verdict.title).toBe('VALORANT: degraded connection this week')
    expect(verdict.sentences).toEqual([`Median this week: 52${NB}ms measured by the game.`])
  })

  it('counts the matches it could not measure when no server was measured', () => {
    const verdict = verdictOf([
      server({ recent: null, basis: null, status: 'unmeasured', matchCount: 3 }),
    ])!

    expect(verdict.status).toBe('unmeasured')
    expect(verdict.title).toBe('None of the 3 matches could be measured')
  })

  it('has nothing to say when no server was played in the window', () => {
    expect(verdictOf([server({ recent: null, status: null, matchCount: 0 })])).toBeNull()
    expect(verdictOf([])).toBeNull()
  })
})

describe('incidentWhen', () => {
  it('says the part of the day, relative to today when close', () => {
    expect(incidentWhen(local(11, 8), now)).toBe('this morning')
    expect(incidentWhen(local(11, 2), now)).toBe('last night')
    expect(incidentWhen(local(10, 14), now)).toBe('yesterday afternoon')
    expect(incidentWhen(local(7, 23), now)).toBe('Wednesday evening')
    expect(incidentWhen(local(4, 9), now)).toBe('on Oct 4')
  })
})

import { describe, expect, it } from 'vitest'
import { MAX_REPORT_MATCHES, reportPayloadSchema } from '@gameroute/shared'

import type { DbHop, SessionMatch, TracerouteWithHops } from '@/types/backend'
import { gameMeasuredCase, lossyCase, sources } from '@/test/report-fixtures'
import {
  at,
  measure,
  riotRoute,
  RIOT,
  sessionDetail,
  sessionMatches,
  thresholds,
  trace,
} from '@/test/session-fixtures'
import {
  buildSharePayload,
  checkSharePayload,
  prepareShare,
  reportGameSlug,
  shareBlocker,
  sharedAddresses,
  sharedOperators,
  shareErrorMessage,
  type ShareOptions,
} from './share'

const options: ShareOptions = {
  recipient: 'isp',
  exactTimes: false,
  appVersion: '0.1.20',
  thresholds: thresholds(),
}

function watchMatches(): SessionMatch[] {
  return sessionMatches().map(match =>
    match.number === 2
      ? { ...match, status: 'watch', trace: measure({ pingMs: 70, lossPct: 0, jitterMs: 9 }) }
      : match
  )
}

function hop(hopNumber: number, ip: string | null, latency: number | null): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 11,
    hopNumber,
    ip,
    hostname: ip ? `hop${hopNumber}.example.net` : null,
    latencyMin: latency,
    latencyAvg: latency,
    latencyMax: latency,
    packetLoss: latency == null ? 100 : 0,
    isProblemHop: false,
    source: null,
    lossStatus: null,
  }
}

function privateHopsTrace(): TracerouteWithHops {
  const route = riotRoute()
  route.segments[0].lastHop = 2
  route.segments[0].hops = 2
  route.segments[1].firstHop = 3
  route.segments[1].lastHop = 5
  route.segments[1].hops = 3
  route.segments[2].firstHop = 6
  route.segments[2].lastHop = 7
  route.lastRespondingHop = 6
  return {
    ...trace(11, RIOT, at(15, 45, 41), route),
    hops: [
      hop(1, '192.168.1.254', 0.6),
      hop(2, '2a01:cb00:1234::1', 1.1),
      hop(3, '100.64.0.1', 3.1),
      hop(4, '10.20.0.1', 3.4),
      hop(5, '77.136.10.6', 3.6),
      hop(6, '87.245.233.46', 17.6),
      hop(7, null, null),
    ],
  }
}

describe('reportGameSlug', () => {
  it('knows the three profiled games whatever the casing', () => {
    expect(reportGameSlug('VALORANT')).toBe('valorant')
    expect(reportGameSlug('Valorant')).toBe('valorant')
    expect(reportGameSlug('League of Legends')).toBe('league-of-legends')
    expect(reportGameSlug('Counter-Strike 2')).toBe('counter-strike-2')
    expect(reportGameSlug('Rocket League')).toBeNull()
  })
})

describe('shareBlocker', () => {
  it('refuses a game without a profile, with its name', () => {
    const detail = sessionDetail({ gameName: 'Rocket League' })
    const matches = sessionMatches()
    const picked = sources(detail, matches, [1])

    expect(shareBlocker(picked)).toEqual({ kind: 'unprofiled_game', game: 'Rocket League' })
    expect(() => buildSharePayload(picked, options)).toThrow()
  })

  it('needs at least one match from a single game', () => {
    const matches = sessionMatches()
    expect(shareBlocker([])).toEqual({ kind: 'empty' })
    expect(
      shareBlocker([
        ...sources(sessionDetail(), matches, [1]),
        ...sources(sessionDetail({ gameName: 'League of Legends' }), matches, [2]),
      ])
    ).toEqual({ kind: 'mixed_games' })
  })

  it(`caps a link at ${MAX_REPORT_MATCHES} matches`, () => {
    const matches = sessionMatches()
    const one = sources(sessionDetail(), matches, [1])[0]
    const many = Array.from({ length: MAX_REPORT_MATCHES + 1 }, () => one)

    expect(shareBlocker(many.slice(0, MAX_REPORT_MATCHES))).toBeNull()
    expect(shareBlocker(many)).toEqual({ kind: 'too_many', max: MAX_REPORT_MATCHES })
  })
})

describe('buildSharePayload', () => {
  it('builds a payload the shared schema accepts', () => {
    const matches = watchMatches()
    const check = prepareShare(sources(sessionDetail(), matches, [1, 2, 3]), options)

    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(reportPayloadSchema.safeParse(JSON.parse(check.json)).success).toBe(true)
    expect(check.payload).toMatchObject({
      version: 1,
      appVersion: '0.1.20',
      gameSlug: 'valorant',
      recipient: 'isp',
      exactTimes: false,
      verdict: { status: 'watch', zone: null },
      isp: { asn: 15557, name: 'SFR' },
    })
    expect(check.payload.matches.map(match => match.number)).toEqual([1, 2, 3])
  })

  it('keeps every address of the home zone out, even a public IPv6 of the box', () => {
    const detail = sessionDetail({ traceroutes: [privateHopsTrace()] })
    const payload = buildSharePayload(sources(detail, sessionMatches(), [1]), options)
    const hops = payload.matches[0].route!.hops

    expect(hops.slice(0, 2).map(item => [item.zone, item.ip, item.asn])).toEqual([
      ['home', null, null],
      ['home', null, null],
    ])
    expect(checkSharePayload(payload).ok).toBe(true)
  })

  it('sends private and CGNAT hops without their address', () => {
    const detail = sessionDetail({ traceroutes: [privateHopsTrace()] })
    const payload = buildSharePayload(sources(detail, sessionMatches(), [1]), options)
    const hops = payload.matches[0].route!.hops

    expect(hops.map(item => item.ip)).toEqual([
      null,
      null,
      null,
      null,
      '77.136.10.6',
      '87.245.233.46',
      null,
    ])
    expect(hops[2]).toMatchObject({ zone: 'isp', asn: 15557, rttMs: 3.1, silent: false })
    expect(hops[6]).toMatchObject({ zone: 'transit', silent: true, rttMs: null, lossPct: null })
  })

  it('never sends a router name', () => {
    const { detail, matches } = lossyCase()
    const check = prepareShare(sources(detail, matches, [1, 2]), options)

    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.json).not.toMatch(/sfr\.net|retn\.net|hostname/)
    expect(check.json).toContain('77.136.10.6')
  })

  it('rounds the times to the hour unless exact times are shared', () => {
    const matches = sessionMatches()
    const picked = sources(sessionDetail(), matches, [2])

    const rounded = buildSharePayload(picked, options).matches[0].startedAt
    const exact = buildSharePayload(picked, { ...options, exactTimes: true }).matches[0].startedAt

    expect(new Date(rounded).getUTCMinutes()).toBe(0)
    expect(Date.parse(rounded)).toBeLessThanOrEqual(Date.parse(matches[1].startedAt))
    expect(Date.parse(matches[1].startedAt) - Date.parse(rounded)).toBeLessThan(3_600_000)
    expect(exact).toBe(new Date(matches[1].startedAt).toISOString())
  })

  it('says when the ping is only a lower bound and where the trace stopped', () => {
    const payload = buildSharePayload(sources(sessionDetail(), watchMatches(), [2]), options)

    expect(payload.matches[0]).toMatchObject({
      source: 'probe',
      pingMedianMs: 70,
      pingAtLeast: true,
      measuredUpToHop: 3,
      reason: 'ping_high',
      status: 'watch',
    })
  })

  it('marks a ping measured by the game as such, at the server', () => {
    const { detail, matches } = gameMeasuredCase()
    const payload = buildSharePayload(sources(detail, matches, [1]), options)

    expect(payload.gameSlug).toBe('league-of-legends')
    expect(payload.matches[0]).toMatchObject({
      source: 'game',
      pingMedianMs: 13.2,
      pingAtLeast: false,
      measuredUpToHop: null,
      usualPingMs: 12.3,
      lossPct: 0.5,
      jitterMs: 2.4,
    })
  })

  it('gives the reason of a degraded match from the same rules as the match screen', () => {
    const { detail, matches } = lossyCase()
    const payload = buildSharePayload(sources(detail, matches, [1]), options)

    expect(payload.matches[0]).toMatchObject({ status: 'critical', reason: 'loss' })
    expect(payload.verdict.status).toBe('critical')
  })

  it('leaves an unmeasured match without figures', () => {
    const payload = buildSharePayload(sources(sessionDetail(), sessionMatches(), [3]), options)

    expect(payload.matches[0]).toMatchObject({
      status: 'unmeasured',
      reason: null,
      pingMedianMs: null,
      pingAtLeast: false,
      route: null,
    })
    expect(payload.verdict).toEqual({ status: 'unmeasured', zone: null })
  })

  it('follows the route and hop switches of the report', () => {
    const picked = sources(sessionDetail(), sessionMatches(), [1])

    expect(buildSharePayload(picked, { ...options, hops: false }).matches[0].route).toMatchObject({
      hops: [],
      segments: expect.arrayContaining([expect.objectContaining({ zone: 'isp' })]),
    })
    expect(buildSharePayload(picked, { ...options, route: false }).matches[0].route).toBeNull()
  })

  it('keeps only the numeric part of a pre-release version', () => {
    const picked = sources(sessionDetail(), sessionMatches(), [1])
    const payload = buildSharePayload(picked, { ...options, appVersion: '0.2.0-beta.1' })

    expect(payload.appVersion).toBe('0.2.0')
  })
})

describe('checkSharePayload', () => {
  it('refuses a payload that breaks the contract instead of sending it', () => {
    const payload = buildSharePayload(sources(sessionDetail(), sessionMatches(), [1]), options)
    payload.matches[0].route!.hops[0].ip = '81.2.3.4'

    const check = checkSharePayload(payload)

    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.issues.join('\n')).toMatch(/matches\.0\.route\.hops\.0\.ip/)
  })
})

describe('shared summary', () => {
  it('lists the public addresses and operators that leave the PC', () => {
    const payload = buildSharePayload(sources(sessionDetail(), sessionMatches(), [1]), options)

    expect(sharedAddresses(payload)).toEqual(['77.136.10.6', '87.245.233.46', RIOT])
    expect(sharedOperators(payload)).toEqual([
      'SFR (AS15557)',
      'RETN (AS9002)',
      'Riot Games (AS6507)',
    ])
  })
})

describe('shareErrorMessage', () => {
  it('turns backend codes into advice', () => {
    expect(shareErrorMessage({ code: 'SHARE_OFFLINE', message: 'timeout' })).toBe(
      'The GameRoute service does not answer. Check your connection and try again.'
    )
    expect(shareErrorMessage({ code: 'SHARE_RATE_LIMITED' })).toMatch(/few minutes/)
    expect(shareErrorMessage(new Error('boom'))).toBe(
      'Sharing did not go through. Try again later.'
    )
  })
})

import { describe, expect, it } from 'vitest'
import { isPublicIp } from './ip'
import { type ReportPayload, reportPayloadSchema, roundToHour } from './report'

function sample(): ReportPayload {
  return {
    version: 1,
    appVersion: '0.1.21',
    gameSlug: 'valorant',
    recipient: 'isp',
    exactTimes: false,
    verdict: { status: 'degraded', zone: 'transit' },
    isp: { asn: 15557, name: 'SFR' },
    matches: [
      {
        number: 1,
        startedAt: '2026-10-11T20:00:00.000Z',
        durationSecs: 2100,
        status: 'degraded',
        reason: 'loss',
        source: 'game',
        pingMedianMs: 18,
        pingP95Ms: 31,
        pingAtLeast: false,
        measuredUpToHop: null,
        usualPingMs: 17,
        lossPct: 2.5,
        jitterMs: 3,
        route: {
          targetIp: '162.249.72.1',
          destinationAsn: 6507,
          destinationName: 'Riot Games',
          destinationSilent: true,
          lastRespondingHop: 5,
          totalMs: 6,
          segments: [
            {
              zone: 'home',
              asn: null,
              name: null,
              firstHop: 1,
              lastHop: 1,
              addedMs: 1,
              status: 'ok',
            },
            {
              zone: 'isp',
              asn: 15557,
              name: 'SFR',
              firstHop: 2,
              lastHop: 5,
              addedMs: 5,
              status: 'ok',
            },
          ],
          hops: [
            {
              number: 1,
              zone: 'home',
              asn: null,
              ip: null,
              silent: false,
              rttMs: 1,
              lossPct: 0,
              status: 'ok',
            },
            {
              number: 5,
              zone: 'isp',
              asn: 15557,
              ip: '194.6.150.68',
              silent: false,
              rttMs: 6,
              lossPct: 0,
              status: 'ok',
            },
          ],
        },
      },
    ],
  }
}

describe('isPublicIp', () => {
  it('accepts public addresses', () => {
    for (const ip of ['8.8.8.8', '162.249.72.1', '2a01:cb00::1', '2001:4860:4860::8888']) {
      expect(isPublicIp(ip)).toBe(true)
    }
  })

  it('rejects private, shared, reserved and malformed addresses', () => {
    for (const ip of [
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.168.1.1',
      '198.51.100.7',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      'fe80::1',
      'fd00::1',
      '2001:db8::1',
      '::ffff:8.8.8.8',
      '1.2.3',
      '01.2.3.4',
      'gameroute.app',
    ]) {
      expect(isPublicIp(ip), ip).toBe(false)
    }
  })
})

describe('reportPayloadSchema', () => {
  it('accepts a sanitised report', () => {
    expect(reportPayloadSchema.safeParse(sample()).success).toBe(true)
  })

  it('refuses an address on a home hop', () => {
    const report = sample()
    report.matches[0].route!.hops[0].ip = '2a01:cb00::1'
    expect(reportPayloadSchema.safeParse(report).success).toBe(false)
  })

  it('refuses private hop addresses', () => {
    const report = sample()
    report.matches[0].route!.hops[1].ip = '100.64.12.1'
    expect(reportPayloadSchema.safeParse(report).success).toBe(false)
  })

  it('refuses exact times unless the player chose to share them', () => {
    const report = sample()
    report.matches[0].startedAt = '2026-10-11T20:17:42.000Z'
    expect(reportPayloadSchema.safeParse(report).success).toBe(false)
    report.exactTimes = true
    expect(reportPayloadSchema.safeParse(report).success).toBe(true)
  })

  it('refuses unknown fields such as hostnames', () => {
    const report = sample()
    const hops: object[] = report.matches[0].route!.hops
    hops[1] = { ...hops[1], hostname: 'x.sfr.net' }
    expect(reportPayloadSchema.safeParse(report).success).toBe(false)
  })

  it('rounds times down to the hour', () => {
    expect(roundToHour('2026-10-11T20:17:42.123Z')).toBe('2026-10-11T20:00:00.000Z')
  })
})

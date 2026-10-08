import type { DbHop, SessionDetail, SessionMatch, TracerouteWithHops } from '@/types/backend'
import {
  at,
  measure,
  riotRoute,
  sessionDetail,
  sessionMatches,
  trace,
  RIOT,
} from '@/test/session-fixtures'
import type { ReportSource } from '@/lib/report'

export function sources(detail: SessionDetail, matches: SessionMatch[], numbers: number[]) {
  return numbers.map((number): ReportSource => ({
    detail,
    matches,
    match: matches.find(match => match.number === number)!,
  }))
}

function hop(overrides: Partial<DbHop> & Pick<DbHop, 'hopNumber'>): DbHop {
  return {
    id: overrides.hopNumber,
    tracerouteId: 21,
    ip: null,
    hostname: null,
    latencyMin: null,
    latencyAvg: null,
    latencyMax: null,
    packetLoss: 100,
    isProblemHop: false,
    source: null,
    lossStatus: null,
    ...overrides,
  }
}

export function lossyTrace(): TracerouteWithHops {
  const route = riotRoute('critical')
  route.segments[2].lastHop = 6
  route.segments[2].hops = 4
  route.lastRespondingHop = 6
  route.totalMs = 38.4
  const lossy = { packetLoss: 33.3, lossStatus: 'critical' } as const
  return {
    ...trace(21, RIOT, at(15, 48), route),
    hops: [
      hop({ hopNumber: 1, ip: '192.168.1.254', latencyAvg: 0.6, latencyMax: 0.9, packetLoss: 0 }),
      hop({
        hopNumber: 2,
        ip: '77.136.10.6',
        hostname: 'bas1.paris.sfr.net',
        latencyAvg: 4.4,
        latencyMax: 5,
        packetLoss: 33.3,
      }),
      hop({
        hopNumber: 3,
        ip: '87.245.233.46',
        hostname: 'ae1-9.rt.th2.par.fr.retn.net',
        latencyAvg: 18.5,
        latencyMax: 19,
        ...lossy,
      }),
      hop({ hopNumber: 4, ip: '87.245.240.1', latencyAvg: 20.1, latencyMax: 21, ...lossy }),
      hop({ hopNumber: 5 }),
      hop({ hopNumber: 6, ip: '87.245.250.9', latencyAvg: 38.4, latencyMax: 40, ...lossy }),
    ],
    status: 'critical',
  }
}

export function gameMeasuredCase() {
  const matches = sessionMatches().map(match =>
    match.number === 1
      ? {
          ...match,
          voice: null,
          game: {
            measuredAt: at(15, 51),
            sampleCount: 142,
            pingMs: 13.2,
            jitterMs: 2.4,
            lossPct: 0.5,
            packetsLost: 3,
            usual: { medianMs: 12.3, sampleCount: 20 },
          },
        }
      : match
  )
  return { detail: sessionDetail({ gameName: 'League of Legends' }), matches }
}

export function regionContextCase() {
  const matches = sessionMatches().map(match =>
    match.number === 2
      ? {
          ...match,
          regionPings: {
            measuredAt: at(15, 50),
            pings: [
              { region: 'Paris', pingMs: 4 },
              { region: 'Frankfurt', pingMs: 13 },
              { region: 'London', pingMs: 14 },
              { region: 'Madrid', pingMs: 31 },
            ],
          },
        }
      : match
  )
  return { detail: sessionDetail(), matches }
}

export function lossyCase() {
  const matches = sessionMatches()
  matches[0] = {
    ...matches[0],
    status: 'critical',
    trace: measure({
      tracerouteId: 21,
      startedAt: at(15, 48),
      offsetSecs: 180,
      measuredHop: 6,
      pingMs: 38.4,
      lossPct: 33.3,
      jitterMs: 6.8,
      usual: { medianMs: 17.6, sampleCount: 12 },
    }),
  }
  const detail = sessionDetail({
    traceroutes: [lossyTrace(), trace(11, RIOT, at(15, 45, 41), riotRoute())],
  })
  return { detail, matches }
}

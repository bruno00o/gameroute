import type {
  LivePoint,
  LiveProbeSample,
  LiveReading,
  LiveStatus,
  MatchIncident,
  PingBasis,
  RouteZone,
  Severity,
  ZoneEvidence,
  ZoneVerdict,
} from '@/types/backend'

export const SERVER = '162.249.72.5'
export const MATCH_START = '2026-09-13T15:45:00.000Z'

export function atMatch(seconds: number): string {
  return new Date(Date.parse(MATCH_START) + seconds * 1000).toISOString()
}

export function floorBasis(hop = 8): PingBasis {
  return {
    source: 'floor',
    atDestination: false,
    measuredHop: hop,
    measuredAsn: 9002,
    serverIp: null,
  }
}

export function gameBasis(): PingBasis {
  return {
    source: 'game',
    atDestination: true,
    measuredHop: null,
    measuredAsn: null,
    serverIp: SERVER,
  }
}

export function reading(overrides: Partial<LiveReading> = {}): LiveReading {
  return {
    point: 'floor',
    basis: floorBasis(),
    atLeast: true,
    zone: 'transit',
    hop: 8,
    hopIp: '87.245.233.46',
    asn: 9002,
    operator: 'RETN Limited',
    medianMs: 18,
    usual: { medianMs: 17, sampleCount: 40 },
    traceMs: 17.6,
    jitterMs: 1.2,
    lossPct: 0,
    lossFloorPct: 0,
    lost: 0,
    sent: 30,
    sampleCount: 30,
    status: 'ok',
    cause: null,
    lastSampleAt: atMatch(600),
    fresh: true,
    ...overrides,
  }
}

export function gameReading(overrides: Partial<LiveReading> = {}): LiveReading {
  return reading({
    point: 'game',
    basis: gameBasis(),
    atLeast: false,
    zone: 'service',
    hop: null,
    hopIp: SERVER,
    asn: null,
    operator: null,
    medianMs: 31,
    usual: { medianMs: 30, sampleCount: 12 },
    traceMs: null,
    ...overrides,
  })
}

export function pointReading(point: LivePoint, overrides: Partial<LiveReading> = {}) {
  const zones: Record<LivePoint, RouteZone> = {
    gateway: 'home',
    isp_edge: 'isp',
    floor: 'transit',
    game: 'service',
  }
  const hops: Record<LivePoint, number | null> = {
    gateway: 1,
    isp_edge: 4,
    floor: 8,
    game: null,
  }
  return reading({
    point,
    zone: zones[point],
    hop: hops[point],
    basis: { ...floorBasis(hops[point] ?? 8), source: point === 'game' ? 'game' : 'floor' },
    ...overrides,
  })
}

export function zone(
  name: RouteZone,
  verdict: ZoneVerdict,
  overrides: Partial<ZoneEvidence> = {}
): ZoneEvidence {
  const operators: Record<RouteZone, [string | null, number | null]> = {
    home: [null, null],
    isp: ['SFR', 15557],
    transit: ['RETN', 9002],
    service: ['Riot Games', 6507],
  }
  const [operator, asn] = operators[name]
  const status: Severity =
    verdict === 'clear'
      ? 'ok'
      : verdict === 'fault' || verdict === 'suspect'
        ? 'degraded'
        : 'unmeasured'
  return {
    zone: name,
    verdict,
    status,
    point: null,
    firstHop: 1,
    lastHop: 3,
    asn,
    operator,
    silent: false,
    ...overrides,
  }
}

export function clearZones(): ZoneEvidence[] {
  return [
    zone('home', 'clear', { point: 'gateway' }),
    zone('isp', 'clear', { point: 'isp_edge' }),
    zone('transit', 'clear', { point: 'floor' }),
    zone('service', 'unmeasured', { silent: true }),
  ]
}

export function liveStatus(overrides: Partial<LiveStatus> = {}): LiveStatus {
  return {
    sessionId: 7,
    gameName: 'VALORANT',
    state: 'live',
    stateSince: atMatch(20),
    frozenReason: null,
    serverIp: SERVER,
    serverPort: 7220,
    matchStartedAt: MATCH_START,
    lastSampleAt: atMatch(600),
    status: 'ok',
    statusSince: atMatch(30),
    cause: null,
    primary: reading(),
    points: [reading()],
    zones: clearZones(),
    fault: null,
    region: null,
    updatedAt: atMatch(600),
    ...overrides,
  }
}

export function waitingStatus(overrides: Partial<LiveStatus> = {}): LiveStatus {
  return liveStatus({
    state: 'waiting',
    serverIp: null,
    serverPort: null,
    matchStartedAt: null,
    lastSampleAt: null,
    status: 'unmeasured',
    statusSince: null,
    primary: null,
    points: [],
    zones: [],
    ...overrides,
  })
}

export function probeSample(
  overrides: Partial<LiveProbeSample> & { second?: number } = {}
): LiveProbeSample {
  const { second = 0, ...rest } = overrides
  return {
    source: 'floor',
    address: SERVER,
    host: null,
    protocol: 'icmp',
    port: null,
    ttl: 8,
    serverIp: SERVER,
    hopIp: '87.245.233.46',
    region: null,
    provider: null,
    sessionId: 7,
    measuredAt: atMatch(second),
    rttMs: 18,
    replyIp: '87.245.233.46',
    atDestination: false,
    recent: { sent: 10, received: 10, lossPct: 0, medianMs: 18, jitterMs: 1 },
    ...rest,
  }
}

export function incident(overrides: Partial<MatchIncident> = {}): MatchIncident {
  return {
    id: 1,
    sessionId: 7,
    serverIp: SERVER,
    serverPort: 7220,
    matchStartedAt: MATCH_START,
    startedAt: atMatch(300),
    endedAt: atMatch(360),
    status: 'degraded',
    cause: 'loss',
    basis: floorBasis(),
    atLeast: true,
    pingMs: 38,
    usualMs: 31,
    lossPct: 4,
    jitterMs: 6,
    zone: 'transit',
    afterHop: 5,
    atHop: 6,
    asn: 9002,
    operator: 'RETN Limited',
    ...overrides,
  }
}

export function transitFault(): Pick<
  LiveStatus,
  'status' | 'statusSince' | 'cause' | 'primary' | 'points' | 'zones' | 'fault'
> {
  const floor = pointReading('floor', {
    status: 'degraded',
    cause: 'loss',
    lossPct: 4,
    lossFloorPct: 3,
    medianMs: 38,
  })
  return {
    status: 'degraded',
    statusSince: atMatch(300),
    cause: 'loss',
    primary: floor,
    points: [pointReading('gateway', { medianMs: 0.6, operator: null, asn: null }), floor],
    zones: [
      zone('home', 'clear', { point: 'gateway' }),
      zone('isp', 'clear', { point: 'isp_edge' }),
      zone('transit', 'fault', { point: 'floor' }),
      zone('service', 'unmeasured', { silent: true }),
    ],
    fault: {
      zone: 'transit',
      zones: ['transit'],
      cause: 'loss',
      afterPoint: 'isp_edge',
      afterHop: 4,
      atPoint: 'floor',
      atHop: 8,
      asn: 9002,
      operator: 'RETN Limited',
    },
  }
}

export function homeFault(): ReturnType<typeof transitFault> {
  const gateway = pointReading('gateway', {
    status: 'degraded',
    cause: 'loss',
    lossPct: 3,
    lossFloorPct: 2,
    medianMs: 9,
    atLeast: false,
    operator: null,
  })
  return {
    status: 'degraded',
    statusSince: atMatch(190),
    cause: 'loss',
    primary: gateway,
    points: [gateway],
    zones: [
      zone('home', 'fault', { point: 'gateway' }),
      zone('isp', 'masked'),
      zone('transit', 'masked'),
      zone('service', 'masked'),
    ],
    fault: {
      zone: 'home',
      zones: ['home'],
      cause: 'loss',
      afterPoint: null,
      afterHop: null,
      atPoint: 'gateway',
      atHop: 1,
      asn: null,
      operator: null,
    },
  }
}

import type {
  DbHop,
  IpPeriod,
  MeasuredFlow,
  OperatorRoute,
  SessionDetail,
  SessionMatch,
  Severity,
  SeverityThresholds,
  TraceMeasure,
  TracerouteWithHops,
} from '@/types/backend'

export function thresholds(): SeverityThresholds {
  return {
    watch: { lossPct: 0.5, jitterMs: 8, overBaselineMs: 20, rttMs: 60 },
    degraded: { lossPct: 2, jitterMs: 15, overBaselineMs: 50, rttMs: 100 },
    critical: { lossPct: 5, jitterMs: 30, overBaselineMs: 100, rttMs: 150 },
  }
}

export const RIOT = '162.249.72.5'
export const RIOT_PARIS = '185.40.64.1'
export const TEAM_VOICE = '20.47.65.180'
export const PARTY_VOICE = '20.157.75.86'

export function at(hours: number, minutes: number, seconds = 0): string {
  return new Date(2026, 8, 13, hours, minutes, seconds).toISOString()
}

function hop(hopNumber: number, ip: string | null, latency: number | null, loss = 0): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 11,
    hopNumber,
    ip,
    hostname: null,
    latencyMin: latency,
    latencyAvg: latency,
    latencyMax: latency == null ? null : latency + 1,
    packetLoss: ip == null ? 100 : loss,
    isProblemHop: false,
    source: null,
    lossStatus: null,
  }
}

export function riotRoute(transitStatus: Severity | null = null): OperatorRoute {
  return {
    segments: [
      {
        zone: 'home',
        asn: null,
        name: null,
        firstHop: 1,
        lastHop: 1,
        hops: 1,
        silentHops: 0,
        addedMs: 0.6,
        status: null,
      },
      {
        zone: 'isp',
        asn: 15557,
        name: 'Societe Francaise Du Radiotelephone - SFR SA',
        firstHop: 2,
        lastHop: 2,
        hops: 1,
        silentHops: 0,
        addedMs: 3,
        status: null,
      },
      {
        zone: 'transit',
        asn: 9002,
        name: 'RETN Limited',
        firstHop: 3,
        lastHop: 4,
        hops: 2,
        silentHops: 1,
        addedMs: 14,
        status: transitStatus,
      },
    ],
    lastRespondingHop: 3,
    totalMs: 17.6,
    destinationSilent: true,
    destinationAsn: 6507,
    destinationName: 'Riot Games, Inc',
  }
}

export function trace(
  id: number,
  targetIp: string,
  startedAt: string,
  route: OperatorRoute | null
): TracerouteWithHops {
  return {
    id,
    sessionId: 1,
    targetIp,
    startedAt,
    completedAt: startedAt,
    problemHopIndex: null,
    tracerouteMethod: 'ICMP (tracert)',
    hops: [
      hop(1, '192.168.1.254', 0.6),
      hop(2, '77.136.10.6', 3.6),
      hop(3, '87.245.233.46', 17.6),
      hop(4, null, null),
    ],
    status: 'ok',
    route,
  }
}

export function measure(overrides: Partial<TraceMeasure> = {}): TraceMeasure {
  return {
    tracerouteId: 11,
    startedAt: at(15, 45, 41),
    completedAt: at(15, 46, 11),
    offsetSecs: 41,
    measuredHop: 3,
    atDestination: false,
    pingMs: 17.6,
    lossPct: 0,
    jitterMs: 1,
    usual: null,
    ...overrides,
  }
}

export function teamVoice(): MeasuredFlow {
  return {
    periodId: 201,
    ip: TEAM_VOICE,
    protocol: 'UDP',
    port: 27020,
    startedAt: at(15, 45),
    endedAt: at(15, 52),
    durationSecs: 420,
    packetCount: 900,
    operator: { asn: 8075, name: 'Microsoft Corporation', city: 'Paris', country: 'France' },
    trace: measure({
      tracerouteId: 12,
      startedAt: at(15, 47),
      offsetSecs: 120,
      measuredHop: 4,
      atDestination: true,
      pingMs: 14,
    }),
    game: null,
    status: 'ok',
  }
}

export function sessionMatches(): SessionMatch[] {
  const riot = { asn: 6507, name: 'Riot Games, Inc', city: 'Los Angeles', country: 'United States' }
  return [
    {
      number: 1,
      periodId: 101,
      ip: RIOT,
      protocol: 'UDP',
      port: 7284,
      startedAt: at(15, 45),
      endedAt: at(15, 51, 36),
      durationSecs: 396,
      packetCount: 12000,
      operator: riot,
      trace: measure(),
      game: null,
      status: 'ok',
      voice: teamVoice(),
    },
    {
      number: 2,
      periodId: 102,
      ip: RIOT,
      protocol: 'UDP',
      port: 7323,
      startedAt: at(15, 54),
      endedAt: at(16, 25, 12),
      durationSecs: 1872,
      packetCount: 56000,
      operator: riot,
      trace: measure({ offsetSecs: -499 }),
      game: null,
      status: 'ok',
      voice: null,
    },
    {
      number: 3,
      periodId: 103,
      ip: RIOT_PARIS,
      protocol: 'UDP',
      port: 7220,
      startedAt: at(16, 27),
      endedAt: at(17, 9, 36),
      durationSecs: 2556,
      packetCount: 80000,
      operator: riot,
      trace: null,
      game: null,
      status: 'unmeasured',
      voice: null,
    },
  ]
}

function period(
  id: number,
  ip: string,
  port: number,
  startedAt: string,
  endedAt: string,
  flowKind: IpPeriod['flowKind']
): IpPeriod {
  return {
    id,
    sessionId: 1,
    ip,
    protocol: 'UDP',
    port,
    startedAt,
    endedAt,
    packetCount: 1000,
    isGameServer: flowKind === 'game',
    flowKind,
  }
}

export function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 1,
    gameName: 'VALORANT',
    startedAt: at(15, 40),
    endedAt: at(20, 14),
    ipPeriods: [
      period(101, RIOT, 7284, at(15, 45), at(15, 51, 36), 'game'),
      period(102, RIOT, 7323, at(15, 54), at(16, 25, 12), 'game'),
      period(103, RIOT_PARIS, 7220, at(16, 27), at(17, 9, 36), 'game'),
      period(201, TEAM_VOICE, 27020, at(15, 45), at(15, 52), 'voice'),
      period(202, PARTY_VOICE, 27022, at(16, 30), at(16, 40), 'voice'),
    ],
    ipSummaries: [],
    traceroutes: [
      trace(11, RIOT, at(15, 45, 41), riotRoute()),
      trace(12, TEAM_VOICE, at(15, 47), null),
    ],
    ...overrides,
  }
}

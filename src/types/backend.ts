// ===== ASN =====
export type AsnInfo = {
  asn: string | null
  isp: string | null
  org: string | null
}

export type GeoLocation = {
  lat: number | null
  lon: number | null
  city: string | null
  country: string | null
}

export type ResolvedIpData = {
  ip: string
  asnInfo: AsnInfo
  geo: GeoLocation
}

// ===== Severity =====
export type Severity = 'ok' | 'watch' | 'degraded' | 'critical' | 'unmeasured'

export type SeverityThreshold = {
  lossPct: number
  jitterMs: number
  overBaselineMs: number
  rttMs: number
}

export type SeverityThresholds = {
  watch: SeverityThreshold
  degraded: SeverityThreshold
  critical: SeverityThreshold
}

// ===== Sessions =====
export type Session = {
  id: number
  gameName: string
  startedAt: string
  endedAt: string | null
}

export type MatchSummary = {
  matchCount: number
  medianPingMs: number | null
  medianPingAtLeast: boolean
  status: Severity | null
}

export type SessionListItem = MatchSummary & {
  id: number
  gameName: string
  startedAt: string
  endedAt: string | null
  endEstimated: boolean
  uniqueIpCount: number
  tracerouteCount: number
}

export type SessionListFilter = {
  search?: string
  game?: string
  toReview?: boolean
}

export type SessionListPage = {
  items: SessionListItem[]
  total: number
  recorded: number
  firstStartedAt: string | null
  games: string[]
}

export type SessionDetail = {
  id: number
  gameName: string
  startedAt: string
  endedAt: string | null
  ipPeriods: IpPeriod[]
  ipSummaries: IpPeriodSummary[]
  traceroutes: TracerouteWithHops[]
}

export type DbHop = {
  id: number
  tracerouteId: number
  hopNumber: number
  ip: string | null
  hostname: string | null
  latencyMin: number | null
  latencyAvg: number | null
  latencyMax: number | null
  packetLoss: number | null
  isProblemHop: boolean
  source: string | null
  lossStatus: Severity | null
}

// ===== IP Periods =====
export type FlowKind = 'game' | 'voice' | 'other'

export type IpPeriod = {
  id: number
  sessionId: number
  ip: string
  protocol: string
  port: number
  startedAt: string
  endedAt: string
  packetCount: number
  isGameServer: boolean
  flowKind: FlowKind | null
}

export type IpPeriodSummary = {
  ip: string
  protocol: string
  port: number
  totalDurationSecs: number
  totalPacketCount: number
  periodCount: number
  firstSeenAt: string
  lastSeenAt: string
  isGameServer: boolean
  flowKind: FlowKind | null
}

// ===== Matches =====
export type FlowOperator = {
  asn: number | null
  name: string | null
  city: string | null
  country: string | null
}

export type TraceMeasure = {
  tracerouteId: number
  startedAt: string
  completedAt: string | null
  offsetSecs: number
  measuredHop: number | null
  atDestination: boolean
  pingMs: number | null
  lossPct: number | null
  jitterMs: number | null
}

export type MeasuredFlow = {
  periodId: number
  ip: string
  protocol: string
  port: number
  startedAt: string
  endedAt: string
  durationSecs: number
  packetCount: number
  operator: FlowOperator | null
  trace: TraceMeasure | null
  status: Severity
}

export type SessionMatch = MeasuredFlow & {
  number: number
  voice: MeasuredFlow | null
}

// ===== Traceroute Records =====
export type TracerouteRecord = {
  id: number
  sessionId: number
  targetIp: string
  startedAt: string
  completedAt: string | null
  problemHopIndex: number | null
  tracerouteMethod: string | null
}

export type TracerouteWithHops = {
  id: number
  sessionId: number
  targetIp: string
  startedAt: string
  completedAt: string | null
  problemHopIndex: number | null
  tracerouteMethod: string | null
  hops: DbHop[]
  status: Severity
  route: OperatorRoute | null
}

// ===== Route by operator =====
export type RouteZone = 'home' | 'isp' | 'transit' | 'service'

export type RouteSegment = {
  zone: RouteZone
  asn: number | null
  name: string | null
  firstHop: number
  lastHop: number
  hops: number
  silentHops: number
  addedMs: number
  status: Severity | null
}

export type OperatorRoute = {
  segments: RouteSegment[]
  lastRespondingHop: number
  totalMs: number
  destinationSilent: boolean
  destinationAsn: number | null
  destinationName: string | null
}

// ===== Game Library =====
export type GameListItem = {
  id: number
  name: string
  executableName: string
  source: string
  iconUrl: string | null
  monitored: boolean
  lastPlayedAt: string | null
  sessionCount: number
  totalPlayTimeSecs: number
}

export type ScanResult = {
  gamesFound: number
  gamesAdded: number
  gamesUpdated: number
}

// ===== Dashboard =====
export type RecentSession = {
  id: number
  gameName: string
  startedAt: string
  endedAt: string | null
  iconUrl: string | null
}

export type DashboardData = {
  totalSessions: number
  totalPlayTimeSecs: number
  uniqueGames: number
  recentSessions: RecentSession[]
}

// ===== Game / Monitoring =====
export type DetectedGame = {
  gameName: string
  pid: number
  detectedAt: string
  exePath: string | null
  icon: string | null
  isManual: boolean
}

export type RunningProcess = {
  pid: number
  name: string
  path: string | null
}

export type RunningApp = {
  name: string
  pid: number
  processCount: number
  path: string | null
}

export type MonitoringStatusResponse = {
  isMonitoring: boolean
  currentGame: DetectedGame | null
  isManualMode: boolean
  currentSessionId: number | null
}

// ===== Server IP =====
export type TracedServerIp = {
  currentPeriodId: number | null
  serverIp: string
  firstSeenAt: string
  totalPacketCount: number
}

// ===== Connection =====
export type CapturedConnection = {
  remoteIp: string
  remotePort: number
  protocol: string
  capturedAt: string
  packetCount: number | null
}

// ===== Hop (runtime, live traceroute) =====
export type HopResult = {
  hopNumber: number
  ip: string | null
  hostname: string | null
  rttProbes: (number | null)[]
  rttMin: number | null
  rttAvg: number | null
  rttMax: number | null
  timeoutCount: number
  probeCount: number
  responded: boolean
}

// ===== IP Metadata =====
export type IpMetadata = {
  ip: string
  asn: string | null
  isp: string | null
  org: string | null
  country: string | null
  city: string | null
  lat: number | null
  lon: number | null
  resolvedAt: string
}

export type IpMetadataCacheStats = {
  memoryEntries: number
  sqliteEntries: number
  entriesWithAsn: number
  entriesWithGeo: number
  oldestEntry: string | null
}

export type PruneCacheResult = {
  entriesDeleted: number
}

// ===== Events Payloads =====
export type GameEndedEvent = {
  gameName: string
  sessionId: number | null
  serverIps: TracedServerIp[]
  sessionDuration: number
  serverIpCount: number
}

export type ServerIpCapturedEvent = {
  ip: string
  port: number
  protocol: string
  capturedAt: string
  packetCount: number | null
}

export type TracerouteStartedEvent = {
  serverIpCount: number
  serverIps: string[]
  startedAt: string
}

export type TracerouteProgressEvent = {
  currentIp: string
  currentIndex: number
  totalCount: number
  progress: number
}

export type TracerouteHopEvent = {
  serverIpIndex: number
  targetIp: string
  hopNumber: number
  ip: string | null
  hostname: string | null
  rttMs: number | null
  timeout: boolean
}

export type TracerouteServerIpCompleteEvent = {
  index: number
  targetIp: string
  success: boolean
  status: Severity
}

export type TracerouteAllCompleteEvent = {
  totalCount: number
  successful: number
  failed: number
  completedAt: string
}

// ===== Network =====
export type NetworkMapEntry = {
  ip: string
  country: string | null
  city: string | null
  lat: number | null
  lon: number | null
  asn: string | null
  isp: string | null
  sessionCount: number
  totalDurationSecs: number
  totalPackets: number
  isGameServer: boolean
}

export type RecurringProblemHop = {
  ip: string
  asn: string | null
  isp: string | null
  occurrenceCount: number
  avgLatency: number | null
  avgPacketLoss: number | null
  isGameServerRoute: boolean
}

export type NetworkOverviewStats = {
  uniqueServerIps: number
  totalTraceroutes: number
  totalProblemHops: number
  avgLatency: number | null
  status: Severity
}

// ===== Insights =====
export type SessionQualityPoint = {
  sessionId: number
  gameName: string
  startedAt: string
  avgLatency: number | null
  problemHopRatio: number
  ipCount: number
}

export type ServerStability = {
  ip: string
  asn: string | null
  isp: string | null
  country: string | null
  lat: number | null
  lon: number | null
  avgLatency: number | null
  avgPacketLoss: number | null
  tracerouteCount: number
  problemHopRatio: number
  isGameServer: boolean
}

export type HourlyQuality = {
  hour: number
  sessionCount: number
  avgLatency: number | null
  problemHopRatio: number
}

export type PingSource = 'trace'

export type PingBasis = {
  source: PingSource
  atDestination: boolean
  measuredHop: number | null
  measuredAsn: number | null
}

export type RecentPing = {
  medianMs: number
  lossPct: number
  sampleCount: number
}

export type UsualPing = {
  medianMs: number | null
  sampleCount: number
}

export type IncidentCause = 'latency' | 'loss'

export type ServerIncident = {
  sessionId: number
  matchNumber: number
  startedAt: string
  measuredAt: string
  status: Severity
  cause: IncidentCause
  basis: PingBasis
  pingMs: number
  usualMs: number | null
  lossPct: number
}

export type ServerSummaryItem = {
  gameName: string
  asn: number | null
  operator: string | null
  city: string | null
  ips: string[]
  matchCount: number
  lastPlayedAt: string
  basis: PingBasis | null
  recent: RecentPing | null
  usual: UsualPing
  status: Severity | null
  lastIncident: ServerIncident | null
}

export type ServerSummary = {
  since: string
  usualMaxSamples: number
  usualMinSamples: number
  servers: ServerSummaryItem[]
}

// ===== Service =====
export type ServiceStatus = {
  running: boolean
  error: string | null
}

// ===== Error types =====
export type MonitoringError = {
  code: string
  message: string
}

export type AsnCommandError = {
  code: string
  message: string
}

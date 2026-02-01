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

// ===== Sessions =====
export type Session = {
  id: number
  gameName: string
  startedAt: string
  endedAt: string | null
}

export type SessionListItem = {
  id: number
  gameName: string
  startedAt: string
  endedAt: string | null
  uniqueIpCount: number
  tracerouteCount: number
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
}

// ===== IP Periods =====
export type IpPeriod = {
  id: number
  sessionId: number
  ip: string
  startedAt: string
  endedAt: string
  packetCount: number
}

export type IpPeriodSummary = {
  ip: string
  totalDurationSecs: number
  totalPacketCount: number
  periodCount: number
  firstSeenAt: string
  lastSeenAt: string
}

// ===== Traceroute Records =====
export type TracerouteRecord = {
  id: number
  sessionId: number
  targetIp: string
  startedAt: string
  completedAt: string | null
  problemHopIndex: number | null
}

export type TracerouteWithHops = {
  id: number
  sessionId: number
  targetIp: string
  startedAt: string
  completedAt: string | null
  problemHopIndex: number | null
  hops: DbHop[]
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
}

export type TracerouteAllCompleteEvent = {
  totalCount: number
  successful: number
  failed: number
  completedAt: string
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

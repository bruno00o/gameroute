import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  DetectedGame,
  GameEndedEvent,
  IpMetadataCacheStats,
  MonitoringStatusResponse,
  PruneCacheResult,
  ResolvedIpData,
  RunningApp,
  RunningProcess,
  ServerIpCapturedEvent,
  SessionDetail,
  SessionListItem,
  TracerouteAllCompleteEvent,
  TracerouteHopEvent,
  TracerouteProgressEvent,
  TracerouteServerIpCompleteEvent,
  TracerouteStartedEvent,
} from '@/types/backend'

// ===== Monitoring =====
export const startMonitoring = () => invoke<void>('start_monitoring')
export const stopMonitoring = () => invoke<void>('stop_monitoring')
export const getMonitoringStatus = () => invoke<MonitoringStatusResponse>('get_monitoring_status')
export const listRunningProcesses = () => invoke<RunningProcess[]>('list_running_processes')
export const listRunningApps = () => invoke<RunningApp[]>('list_running_apps')
export const startManualMonitoring = (pid: number) =>
  invoke<void>('start_manual_monitoring', { pid })
export const cancelTraceroute = () => invoke<void>('cancel_traceroute')

// ===== Sessions =====
export const getSessions = (limit: number, offset: number) =>
  invoke<SessionListItem[]>('get_sessions', { limit, offset })
export const getSessionDetail = (id: number) =>
  invoke<SessionDetail | null>('get_session_detail', { id })
export const getSessionCount = () => invoke<number>('get_session_count')
export const deleteSession = (id: number) => invoke<void>('delete_session', { id })

// ===== ASN / Cache =====
export const resolveAsn = (ips: string[]) => invoke<ResolvedIpData[]>('resolve_asn', { ips })
export const clearIpMetadataCache = () => invoke<void>('clear_ip_metadata_cache')
export const getIpMetadataStats = () => invoke<IpMetadataCacheStats>('get_ip_metadata_stats')
export const pruneIpMetadataCache = () => invoke<PruneCacheResult>('prune_ip_metadata_cache')

// ===== Event listeners =====
export const onGameDetected = (cb: (game: DetectedGame) => void): Promise<UnlistenFn> =>
  listen<DetectedGame>('game-detected', e => cb(e.payload))
export const onGameEnded = (cb: (event: GameEndedEvent) => void): Promise<UnlistenFn> =>
  listen<GameEndedEvent>('game-ended', e => cb(e.payload))
export const onServerIpCaptured = (
  cb: (event: ServerIpCapturedEvent) => void
): Promise<UnlistenFn> => listen<ServerIpCapturedEvent>('server-ip-captured', e => cb(e.payload))
export const onTracerouteStarted = (
  cb: (event: TracerouteStartedEvent) => void
): Promise<UnlistenFn> => listen<TracerouteStartedEvent>('traceroute-started', e => cb(e.payload))
export const onTracerouteProgress = (
  cb: (event: TracerouteProgressEvent) => void
): Promise<UnlistenFn> => listen<TracerouteProgressEvent>('traceroute-progress', e => cb(e.payload))
export const onTracerouteHop = (cb: (event: TracerouteHopEvent) => void): Promise<UnlistenFn> =>
  listen<TracerouteHopEvent>('traceroute-hop', e => cb(e.payload))
export const onTracerouteServerIpComplete = (
  cb: (event: TracerouteServerIpCompleteEvent) => void
): Promise<UnlistenFn> =>
  listen<TracerouteServerIpCompleteEvent>('traceroute-server-ip-complete', e => cb(e.payload))
export const onTracerouteAllComplete = (
  cb: (event: TracerouteAllCompleteEvent) => void
): Promise<UnlistenFn> =>
  listen<TracerouteAllCompleteEvent>('traceroute-all-complete', e => cb(e.payload))

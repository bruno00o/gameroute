import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AppSettings,
  DetectedGame,
  GameEndedEvent,
  GameListItem,
  GamePingSample,
  HourlyQuality,
  IpMetadataCacheStats,
  LiveProbeConfig,
  LiveProbeSample,
  LiveProbeState,
  MonitoringStatusResponse,
  NetworkOverviewStats,
  PruneCacheResult,
  RecurringProblemHop,
  ResolvedIpData,
  RouteChange,
  RunningApp,
  ServerIpCapturedEvent,
  ServerStability,
  ServerSummary,
  SessionDetail,
  SessionListFilter,
  SessionListPage,
  SessionMatch,
  SessionQualityPoint,
  ScanResult,
  SeverityThresholds,
  StorageStats,
  TracerouteAllCompleteEvent,
  TracerouteHopEvent,
  TracerouteProgressEvent,
  TracerouteServerIpCompleteEvent,
  ServiceStatus,
  TracerouteStartedEvent,
  UsualRoute,
} from '@/types/backend'

// ===== Monitoring =====
export const startMonitoring = () => invoke<void>('start_monitoring')
export const stopMonitoring = () => invoke<void>('stop_monitoring')
export const getMonitoringStatus = () => invoke<MonitoringStatusResponse>('get_monitoring_status')
export const listRunningApps = () => invoke<RunningApp[]>('list_running_apps')
export const startManualMonitoring = (pid: number) =>
  invoke<void>('start_manual_monitoring', { pid })
export const cancelTraceroute = () => invoke<void>('cancel_traceroute')

// ===== Sessions =====
export const getSessionList = (filter: SessionListFilter, limit: number, offset: number) =>
  invoke<SessionListPage>('get_session_list', { filter, limit, offset })
export const getSessionDetail = (id: number) =>
  invoke<SessionDetail | null>('get_session_detail', { id })
export const getSessionMatches = (id: number) =>
  invoke<SessionMatch[]>('get_session_matches', { id })
export const getPreviousSessionId = (gameName: string, beforeStartedAt: string) =>
  invoke<number | null>('get_previous_session_id', { gameName, beforeStartedAt })
export const deleteSession = (id: number) => invoke<void>('delete_session', { id })
export const retryTraceroutes = (sessionId: number) =>
  invoke<void>('retry_traceroutes', { sessionId })

// ===== Games =====
export const scanSteamGames = () => invoke<ScanResult>('scan_steam_games')
export const scanEpicGames = () => invoke<ScanResult>('scan_epic_games')
export const scanRiotGames = () => invoke<ScanResult>('scan_riot_games')
export const scanAllGames = () => invoke<ScanResult>('scan_all_games')
export const getGames = (limit: number, offset: number) =>
  invoke<GameListItem[]>('get_games', { limit, offset })
export const getGameCount = () => invoke<number>('get_game_count')
export const getMonitoredGameCount = () => invoke<number>('get_monitored_game_count')
export const addManualGame = (name: string, executablePath: string) =>
  invoke<number>('add_manual_game', { name, executablePath })
export const removeGame = (id: number) => invoke<void>('remove_game', { id })
export const toggleGameMonitored = (id: number, monitored: boolean) =>
  invoke<void>('toggle_game_monitored', { id, monitored })
export const searchGames = (query: string, limit: number, offset: number) =>
  invoke<GameListItem[]>('search_games', { query, limit, offset })
export const searchGameCount = (query: string) => invoke<number>('search_game_count', { query })

// ===== Network =====
export const getRecurringProblemHops = () =>
  invoke<RecurringProblemHop[]>('get_recurring_problem_hops')
export const getNetworkOverviewStats = () =>
  invoke<NetworkOverviewStats>('get_network_overview_stats')
export const getSeverityThresholds = () => invoke<SeverityThresholds>('get_severity_thresholds')

// ===== Insights =====
export const getNetworkQualityOverTime = () =>
  invoke<SessionQualityPoint[]>('get_network_quality_over_time')
export const getServerStability = () => invoke<ServerStability[]>('get_server_stability')
export const getServerSummary = (days?: number) =>
  invoke<ServerSummary>('get_server_summary', { days })
export const getHourlyQuality = () => invoke<HourlyQuality[]>('get_hourly_quality')
export const getUsualRoute = (days?: number) => invoke<UsualRoute[]>('get_usual_route', { days })
export const getRouteChanges = (days?: number) =>
  invoke<RouteChange[]>('get_route_changes', { days })

// ===== ASN / Cache =====
export const resolveAsn = (ips: string[]) => invoke<ResolvedIpData[]>('resolve_asn', { ips })
export const clearIpMetadataCache = () => invoke<void>('clear_ip_metadata_cache')
export const getIpMetadataStats = () => invoke<IpMetadataCacheStats>('get_ip_metadata_stats')
export const pruneIpMetadataCache = () => invoke<PruneCacheResult>('prune_ip_metadata_cache')

// ===== Service =====
export const checkCaptureServiceStatus = () =>
  invoke<ServiceStatus>('check_capture_service_status')
export const restartCaptureService = () => invoke<void>('restart_capture_service')
export const openLogDir = () => invoke<void>('open_log_dir')

// ===== Settings =====
export const getAppSettings = () => invoke<AppSettings>('get_app_settings')
export const setMinimizeToTray = (enabled: boolean) =>
  invoke<AppSettings>('set_minimize_to_tray', { enabled })
export const setSessionRetention = (days: number | null) =>
  invoke<AppSettings>('set_session_retention', { days })
export const getStorageStats = () => invoke<StorageStats>('get_storage_stats')
export const deleteAllData = () => invoke<void>('delete_all_data')

// ===== Live probe =====
export const getLiveProbeState = () => invoke<LiveProbeState>('get_live_probe_state')
export const getLiveProbeConfig = () => invoke<LiveProbeConfig>('get_live_probe_config')
export const setLiveProbeConfig = (config: LiveProbeConfig) =>
  invoke<LiveProbeConfig>('set_live_probe_config', { config })

// ===== Export =====
export const writeExportFile = (path: string, content: string) =>
  invoke<void>('write_export_file', { path, content })

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
export const onGamePingSample = (cb: (sample: GamePingSample) => void): Promise<UnlistenFn> =>
  listen<GamePingSample>('game-ping-sample', e => cb(e.payload))
export const onLiveProbeSample = (cb: (sample: LiveProbeSample) => void): Promise<UnlistenFn> =>
  listen<LiveProbeSample>('live-probe-sample', e => cb(e.payload))

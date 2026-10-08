import { create } from 'zustand'
import type { LiveState } from '@/lib/live-state'
import type { DetectedGame, MonitoringStatusResponse, ServerIpCapturedEvent } from '@/types/backend'

type MonitoringStore = {
  isMonitoring: boolean
  currentGame: DetectedGame | null
  isManualMode: boolean
  currentSessionId: number | null
  seenIps: Set<string>
  serverIpCount: number
  lastServer: ServerIpCapturedEvent | null
  setStatus: (status: MonitoringStatusResponse) => void
  addCapturedIp: (event: ServerIpCapturedEvent) => void
  clearCapturedIps: () => void
  reset: () => void
}

export const useMonitoringStore = create<MonitoringStore>(set => ({
  isMonitoring: false,
  currentGame: null,
  isManualMode: false,
  currentSessionId: null,
  seenIps: new Set(),
  serverIpCount: 0,
  lastServer: null,
  setStatus: status =>
    set({
      isMonitoring: status.isMonitoring,
      currentGame: status.currentGame,
      isManualMode: status.isManualMode,
      currentSessionId: status.currentSessionId,
    }),
  addCapturedIp: event =>
    set(state => {
      if (state.seenIps.has(event.ip)) return state
      const seenIps = new Set(state.seenIps)
      seenIps.add(event.ip)
      return {
        seenIps,
        serverIpCount: state.serverIpCount + 1,
        lastServer: event,
      }
    }),
  clearCapturedIps: () =>
    set({
      seenIps: new Set(),
      serverIpCount: 0,
      lastServer: null,
    }),
  reset: () =>
    set({
      isMonitoring: false,
      currentGame: null,
      isManualMode: false,
      currentSessionId: null,
      seenIps: new Set(),
      serverIpCount: 0,
      lastServer: null,
    }),
}))

export function selectLiveState(
  state: Pick<MonitoringStore, 'isMonitoring' | 'currentGame' | 'serverIpCount'>,
  isServiceRunning = true
): LiveState {
  if (!state.isMonitoring || !state.currentGame) return 'idle'
  if (!isServiceRunning) return 'stale'
  return state.serverIpCount > 0 ? 'live' : 'measuring'
}

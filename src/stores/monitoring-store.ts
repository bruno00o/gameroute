import { create } from 'zustand'
import type { DetectedGame, MonitoringStatusResponse, ServerIpCapturedEvent } from '@/types/backend'

type MonitoringStore = {
  isMonitoring: boolean
  currentGame: DetectedGame | null
  isManualMode: boolean
  currentSessionId: number | null
  capturedIps: ServerIpCapturedEvent[]
  serverIpCount: number
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
  capturedIps: [],
  serverIpCount: 0,
  setStatus: status =>
    set({
      isMonitoring: status.isMonitoring,
      currentGame: status.currentGame,
      isManualMode: status.isManualMode,
      currentSessionId: status.currentSessionId,
    }),
  addCapturedIp: event =>
    set(state => {
      const alreadySeen = state.capturedIps.some(e => e.ip === event.ip)
      return {
        capturedIps: [...state.capturedIps, event],
        serverIpCount: alreadySeen ? state.serverIpCount : state.serverIpCount + 1,
      }
    }),
  clearCapturedIps: () =>
    set({
      capturedIps: [],
      serverIpCount: 0,
    }),
  reset: () =>
    set({
      isMonitoring: false,
      currentGame: null,
      isManualMode: false,
      currentSessionId: null,
      capturedIps: [],
      serverIpCount: 0,
    }),
}))

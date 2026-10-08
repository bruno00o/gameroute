import { create } from 'zustand'
import type {
  Severity,
  TracerouteAllCompleteEvent,
  TracerouteHopEvent,
  TracerouteProgressEvent,
  TracerouteServerIpCompleteEvent,
  TracerouteStartedEvent,
} from '@/types/backend'

type TraceStore = {
  isRunning: boolean
  progress: TracerouteProgressEvent | null
  liveHops: Map<string, TracerouteHopEvent[]>
  serverIps: string[]
  startedAt: string | null
  completedIps: Map<string, boolean>
  statuses: Map<string, Severity>
  summary: TracerouteAllCompleteEvent | null
  setRunning: (running: boolean) => void
  setProgress: (progress: TracerouteProgressEvent | null) => void
  addHop: (hop: TracerouteHopEvent) => void
  setStarted: (event: TracerouteStartedEvent) => void
  setIpComplete: (event: TracerouteServerIpCompleteEvent) => void
  setAllComplete: (event: TracerouteAllCompleteEvent) => void
  reset: () => void
}

export const useTraceStore = create<TraceStore>(set => ({
  isRunning: false,
  progress: null,
  liveHops: new Map(),
  serverIps: [],
  startedAt: null,
  completedIps: new Map(),
  statuses: new Map(),
  summary: null,
  setRunning: running => set({ isRunning: running }),
  setProgress: progress => set({ progress }),
  addHop: hop =>
    set(state => {
      const next = new Map(state.liveHops)
      const existing = next.get(hop.targetIp) ?? []
      next.set(hop.targetIp, [...existing, hop])
      return { liveHops: next }
    }),
  setStarted: event =>
    set(state =>
      state.isRunning
        ? { serverIps: [...new Set([...state.serverIps, ...event.serverIps])] }
        : {
            isRunning: true,
            serverIps: event.serverIps,
            startedAt: event.startedAt,
            progress: null,
            liveHops: new Map(),
            completedIps: new Map(),
            statuses: new Map(),
            summary: null,
          },
    ),
  setIpComplete: event =>
    set(state => {
      const next = new Map(state.completedIps)
      next.set(event.targetIp, event.success)
      const statuses = new Map(state.statuses)
      statuses.set(event.targetIp, event.status)
      return { completedIps: next, statuses }
    }),
  setAllComplete: event =>
    set(state => {
      // Ignore stale event if traceroute was already cancelled/reset
      if (!state.isRunning) return state
      return { isRunning: false, summary: event }
    }),
  reset: () =>
    set({
      isRunning: false,
      progress: null,
      liveHops: new Map(),
      serverIps: [],
      startedAt: null,
      completedIps: new Map(),
      statuses: new Map(),
      summary: null,
    }),
}))

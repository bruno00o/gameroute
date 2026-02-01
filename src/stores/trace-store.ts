import { create } from 'zustand'
import type {
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
    set({
      isRunning: true,
      serverIps: event.serverIps,
      startedAt: event.startedAt,
      progress: null,
      liveHops: new Map(),
      completedIps: new Map(),
      summary: null,
    }),
  setIpComplete: event =>
    set(state => {
      const next = new Map(state.completedIps)
      next.set(event.targetIp, event.success)
      return { completedIps: next }
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
      summary: null,
    }),
}))

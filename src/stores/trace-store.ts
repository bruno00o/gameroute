import { create } from 'zustand'
import type {
  DbHop,
  OperatorRoute,
  Severity,
  TracedTarget,
  TracerouteAllCompleteEvent,
  TracerouteHopEvent,
  TracerouteProgressEvent,
  TracerouteServerIpCompleteEvent,
  TracerouteStartedEvent,
} from '@/types/backend'

export type TraceResult = {
  success: boolean
  status: Severity
  hops: DbHop[]
  route: OperatorRoute | null
}

type TraceStore = {
  isRunning: boolean
  progress: TracerouteProgressEvent | null
  liveHops: Map<string, TracerouteHopEvent[]>
  serverIps: string[]
  targets: Map<string, TracedTarget>
  startedAt: string | null
  results: Map<string, TraceResult>
  summary: TracerouteAllCompleteEvent | null
  setRunning: (running: boolean) => void
  setProgress: (progress: TracerouteProgressEvent | null) => void
  addHop: (hop: TracerouteHopEvent) => void
  setStarted: (event: TracerouteStartedEvent) => void
  setIpComplete: (event: TracerouteServerIpCompleteEvent) => void
  setAllComplete: (event: TracerouteAllCompleteEvent) => void
  reset: () => void
}

const initial = {
  isRunning: false,
  progress: null,
  liveHops: new Map<string, TracerouteHopEvent[]>(),
  serverIps: [] as string[],
  targets: new Map<string, TracedTarget>(),
  startedAt: null,
  results: new Map<string, TraceResult>(),
  summary: null,
}

function targetMap(event: TracerouteStartedEvent): Map<string, TracedTarget> {
  return new Map((event.targets ?? []).map(target => [target.ip, target]))
}

export const useTraceStore = create<TraceStore>(set => ({
  ...initial,
  setRunning: running => set({ isRunning: running }),
  setProgress: progress => set({ progress }),
  addHop: hop =>
    set(state => {
      const next = new Map(state.liveHops)
      const others = (next.get(hop.targetIp) ?? []).filter(h => h.hopNumber !== hop.hopNumber)
      next.set(
        hop.targetIp,
        [...others, hop].sort((a, b) => a.hopNumber - b.hopNumber)
      )
      return { liveHops: next }
    }),
  setStarted: event =>
    set(state => {
      if (!state.isRunning) {
        return {
          isRunning: true,
          serverIps: event.serverIps,
          targets: targetMap(event),
          startedAt: event.startedAt,
          progress: null,
          liveHops: new Map(),
          results: new Map(),
          summary: null,
        }
      }

      const liveHops = new Map(state.liveHops)
      const results = new Map(state.results)
      for (const ip of event.serverIps) {
        if (state.serverIps.includes(ip) && results.has(ip)) {
          results.delete(ip)
          liveHops.delete(ip)
        }
      }
      return {
        serverIps: [...new Set([...state.serverIps, ...event.serverIps])],
        targets: new Map([...state.targets, ...targetMap(event)]),
        liveHops,
        results,
      }
    }),
  setIpComplete: event =>
    set(state => {
      const results = new Map(state.results)
      results.set(event.targetIp, {
        success: event.success,
        status: event.status,
        hops: event.hops,
        route: event.route,
      })
      return { results }
    }),
  setAllComplete: event =>
    set(state => {
      if (!state.isRunning) return state
      return { isRunning: false, summary: event }
    }),
  reset: () =>
    set({
      ...initial,
      liveHops: new Map(),
      targets: new Map(),
      results: new Map(),
      serverIps: [],
    }),
}))

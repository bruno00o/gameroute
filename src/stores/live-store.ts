import { create } from 'zustand'

import type { GamePingSample, LiveProbeSample, LiveProbeState, LiveStatus } from '@/types/backend'
import {
  countsAsBeat,
  emptySeries,
  gamePoint,
  mergeSeries,
  probePoint,
  trackSeries,
  trimSeries,
  type LiveSeries,
} from '@/lib/live'

type LiveStore = {
  status: LiveStatus | null
  beat: number
  series: LiveSeries
  seriesKey: string | null
  setStatus: (status: LiveStatus | null) => void
  pushProbe: (sample: LiveProbeSample) => void
  pushGame: (sample: GamePingSample) => void
  hydrate: (status: LiveStatus | null, probes: LiveProbeState | null) => void
  reset: () => void
}

function keyOf(sessionId: number, serverIp: string | null, matchStartedAt: string | null) {
  return `${sessionId}|${serverIp ?? ''}|${matchStartedAt ?? ''}`
}

function statusKey(status: LiveStatus) {
  return keyOf(status.sessionId, status.serverIp, status.matchStartedAt)
}

function updatedAt(status: LiveStatus | null): number {
  return status ? Date.parse(status.updatedAt) || 0 : 0
}

export const useLiveStore = create<LiveStore>((set, get) => ({
  status: null,
  beat: 0,
  series: emptySeries(),
  seriesKey: null,
  setStatus: status =>
    set(state => {
      if (!status) return { status, series: emptySeries(), seriesKey: null }
      if (status.state === 'waiting') {
        return state.seriesKey === null
          ? { status }
          : { status, series: emptySeries(), seriesKey: null }
      }
      const key = statusKey(status)
      if (state.seriesKey === key || state.seriesKey === null) return { status, seriesKey: key }
      return { status, series: emptySeries(), seriesKey: key }
    }),
  pushProbe: sample =>
    set(state => {
      const status = state.status
      if (status && status.sessionId !== sample.sessionId) return state
      if (status && sample.serverIp && status.serverIp && sample.serverIp !== status.serverIp) {
        return state
      }
      const beat = countsAsBeat(sample.source, status?.primary?.point ?? null)
        ? state.beat + 1
        : state.beat
      if (sample.source !== 'floor') return beat === state.beat ? state : { beat }
      const point = probePoint(sample)
      if (!point) return { beat }
      const series = {
        ...state.series,
        floor: trimSeries([...state.series.floor, point]),
      }
      return { beat, series }
    }),
  pushGame: sample =>
    set(state => {
      const status = state.status
      if (sample.source !== 'game') return state
      if (status?.serverIp && sample.peerIp && sample.peerIp !== status.serverIp) return state
      const point = gamePoint(sample)
      if (!point) return state
      const beat = countsAsBeat('game', status?.primary?.point ?? null)
        ? state.beat + 1
        : state.beat
      return {
        beat,
        series: { ...state.series, game: trimSeries([...state.series.game, point]) },
      }
    }),
  hydrate: (status, probes) => {
    const current = get().status
    if (status && updatedAt(current) <= updatedAt(status)) {
      get().setStatus(status)
    }
    const known = get().status
    if (!probes || !known || probes.sessionId !== known.sessionId) return
    set(state => ({
      series: {
        ...state.series,
        floor: mergeSeries(state.series.floor, trackSeries(probes.floor)),
      },
    }))
  },
  reset: () => set({ status: null, beat: 0, series: emptySeries(), seriesKey: null }),
}))

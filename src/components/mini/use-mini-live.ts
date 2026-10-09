import { useEffect, useState } from 'react'

import {
  getLiveProbeState,
  getLiveStatus,
  onGamePingSample,
  onLiveProbeSample,
  onLiveStatus,
} from '@/lib/tauri'
import { appendSample, toSample, type MiniSample, type SampleSource } from '@/lib/mini'
import type { LiveStatus, PingSource } from '@/types/backend'

export type MiniTrack = { samples: MiniSample[]; last: SampleSource }

export type MiniTracks = Partial<Record<PingSource, MiniTrack>>

type Live = { status: LiveStatus | null; tracks: MiniTracks }

type TaggedSample = SampleSource & { sessionId: number }

export function addSample(tracks: MiniTracks, sample: SampleSource): MiniTracks {
  const samples = appendSample(tracks[sample.source]?.samples ?? [], toSample(sample))
  return { ...tracks, [sample.source]: { samples, last: sample } }
}

function receive(live: Live, sample: TaggedSample): Live {
  if (live.status && live.status.sessionId !== sample.sessionId) return live
  return { ...live, tracks: addSample(live.tracks, sample) }
}

function update(live: Live, status: LiveStatus | null): Live {
  const sameMatch =
    status != null && (live.status == null || live.status.sessionId === status.sessionId)
  return { status, tracks: sameMatch ? live.tracks : {} }
}

export function useMiniLive(): Live {
  const [live, setLive] = useState<Live>({ status: null, tracks: {} })

  useEffect(() => {
    let active = true
    Promise.all([getLiveStatus(), getLiveProbeState()])
      .then(([status, probe]) => {
        if (!active) return
        const seeded = [probe.floor, probe.gateway, probe.ispEdge]
          .flatMap(track => track?.samples ?? [])
          .filter(sample => sample.sessionId === status?.sessionId)
          .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt))
        setLive(current => {
          const base = current.status ? current : update(current, status)
          return { ...base, tracks: seeded.reduce(addSample, base.tracks) }
        })
      })
      .catch(e => console.warn('[mini] Failed to load the live status:', e))

    const unlisteners = [
      onLiveStatus(status => setLive(current => update(current, status))),
      onLiveProbeSample(sample => setLive(current => receive(current, sample))),
      onGamePingSample(sample => setLive(current => receive(current, sample))),
    ]
    return () => {
      active = false
      for (const unlisten of unlisteners) unlisten.then(fn => fn()).catch(() => {})
    }
  }, [])

  return live
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

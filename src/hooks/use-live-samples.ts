import { useEffect } from 'react'

import {
  getLiveProbeState,
  getLiveStatus,
  onGamePingSample,
  onLiveProbeSample,
  onLiveStatus,
} from '@/lib/tauri'
import { useLiveStore } from '@/stores/live-store'

export function useLiveSamples() {
  useEffect(() => {
    let active = true
    const { setStatus, pushProbe, pushGame, hydrate } = useLiveStore.getState()
    const unlisteners = [
      onLiveStatus(status => setStatus(status)),
      onLiveProbeSample(sample => pushProbe(sample)),
      onGamePingSample(sample => pushGame(sample)),
    ]

    Promise.all([getLiveStatus(), getLiveProbeState().catch(() => null)])
      .then(([status, probes]) => {
        if (active) hydrate(status, probes)
      })
      .catch(e => {
        console.warn('[live] Failed to read the live status:', e)
      })

    return () => {
      active = false
      for (const unlisten of unlisteners) {
        unlisten.then(fn => fn()).catch(() => {})
      }
    }
  }, [])
}

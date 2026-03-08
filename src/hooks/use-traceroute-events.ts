import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import {
  onTracerouteAllComplete,
  onTracerouteHop,
  onTracerouteProgress,
  onTracerouteServerIpComplete,
  onTracerouteStarted,
} from '@/lib/tauri'
import { useTraceStore } from '@/stores/trace-store'

export function useTracerouteEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unlisteners = [
      onTracerouteStarted(event => {
        useTraceStore.getState().setStarted(event)
      }),
      onTracerouteProgress(event => {
        useTraceStore.getState().setProgress(event)
      }),
      onTracerouteHop(hop => {
        useTraceStore.getState().addHop(hop)
      }),
      onTracerouteServerIpComplete(event => {
        useTraceStore.getState().setIpComplete(event)
        queryClient.invalidateQueries({ queryKey: ['session'] })
      }),
      onTracerouteAllComplete(event => {
        useTraceStore.getState().setAllComplete(event)
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
        queryClient.invalidateQueries({ queryKey: ['session'] })
      }),
    ]

    return () => {
      for (const unlisten of unlisteners) {
        unlisten.then(fn => fn()).catch(() => {})
      }
    }
  }, [queryClient])
}

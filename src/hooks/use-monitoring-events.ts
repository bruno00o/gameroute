import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { getMonitoringStatus, onGameDetected, onGameEnded, onServerIpCaptured } from '@/lib/tauri'
import { useMonitoringStore } from '@/stores/monitoring-store'

const SESSION_POLL_INTERVAL_MS = 300
const SESSION_POLL_MAX_ATTEMPTS = 20

export function useMonitoringEvents() {
  const setStatus = useMonitoringStore(s => s.setStatus)
  const queryClient = useQueryClient()
  const activePollRef = useRef<ReturnType<typeof setInterval>>(undefined)

  // Sync initial status on mount
  useEffect(() => {
    getMonitoringStatus()
      .then(setStatus)
      .catch(e => {
        console.warn('[monitoring] Failed to fetch initial status:', e)
      })
  }, [setStatus])

  // Subscribe to events
  useEffect(() => {
    const unlisteners = [
      onGameDetected(game => {
        useMonitoringStore.setState({
          currentGame: game,
          isMonitoring: true,
          seenIps: new Set(),
          serverIpCount: 0,
        })
        // Clear any previous polling interval
        clearInterval(activePollRef.current)
        // Poll for session ID instead of blind setTimeout
        let attempts = 0
        activePollRef.current = setInterval(() => {
          attempts++
          getMonitoringStatus()
            .then(status => {
              if (status.currentSessionId) {
                clearInterval(activePollRef.current)
                useMonitoringStore.setState({
                  currentSessionId: status.currentSessionId,
                })
                queryClient.invalidateQueries({ queryKey: ['sessions'] })
              } else if (attempts >= SESSION_POLL_MAX_ATTEMPTS) {
                clearInterval(activePollRef.current)
                console.warn('[monitoring] Session ID not available after polling')
                queryClient.invalidateQueries({ queryKey: ['sessions'] })
              }
            })
            .catch(e => {
              console.warn('[monitoring] Failed to poll session status:', e)
              clearInterval(activePollRef.current)
            })
        }, SESSION_POLL_INTERVAL_MS)
      }),
      onGameEnded(() => {
        useMonitoringStore.setState({
          currentGame: null,
          seenIps: new Set(),
          serverIpCount: 0,
          currentSessionId: null,
        })
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }),
      onServerIpCaptured(event => {
        useMonitoringStore.getState().addCapturedIp(event)
      }),
    ]

    return () => {
      clearInterval(activePollRef.current)
      for (const unlisten of unlisteners) {
        unlisten.then(fn => fn()).catch(() => {})
      }
    }
  }, [queryClient])
}

import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getMonitoringStatus, onGameDetected, onGameEnded, onServerIpCaptured } from '@/lib/tauri'
import { useMonitoringStore } from '@/stores/monitoring-store'

const SESSION_POLL_INTERVAL_MS = 300
const SESSION_POLL_MAX_ATTEMPTS = 20

export function useMonitoringEvents() {
  const setStatus = useMonitoringStore(s => s.setStatus)
  const queryClient = useQueryClient()

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
          capturedIps: [],
          serverIpCount: 0,
        })
        // Poll for session ID instead of blind setTimeout
        let attempts = 0
        const poll = setInterval(() => {
          attempts++
          getMonitoringStatus()
            .then(status => {
              if (status.currentSessionId) {
                clearInterval(poll)
                useMonitoringStore.setState({
                  currentSessionId: status.currentSessionId,
                })
                queryClient.invalidateQueries({ queryKey: ['sessions'] })
              } else if (attempts >= SESSION_POLL_MAX_ATTEMPTS) {
                clearInterval(poll)
                console.warn('[monitoring] Session ID not available after polling')
                queryClient.invalidateQueries({ queryKey: ['sessions'] })
              }
            })
            .catch(e => {
              console.warn('[monitoring] Failed to poll session status:', e)
              clearInterval(poll)
            })
        }, SESSION_POLL_INTERVAL_MS)
      }),
      onGameEnded(() => {
        useMonitoringStore.setState({
          currentGame: null,
          capturedIps: [],
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
      for (const unlisten of unlisteners) {
        unlisten.then(fn => fn())
      }
    }
  }, [queryClient])
}

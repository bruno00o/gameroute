import { useEffect, useRef } from 'react'

import { startMonitoring } from '@/lib/tauri'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { useSettingsStore } from '@/stores/settings-store'

export function useAutoStartMonitoring() {
  const autoStart = useSettingsStore(s => s.autoStartMonitoring)
  const didRun = useRef(false)

  useEffect(() => {
    if (!autoStart || didRun.current) return
    didRun.current = true

    startMonitoring()
      .then(() => {
        useMonitoringStore.setState({ isMonitoring: true })
      })
      .catch(e => {
        console.warn('[monitoring] Auto-start failed:', e)
      })
  }, [autoStart])
}

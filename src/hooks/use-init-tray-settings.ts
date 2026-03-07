import { useEffect } from 'react'
import { setMinimizeToTray } from '@/lib/tauri'
import { useSettingsStore } from '@/stores/settings-store'

export function useInitTraySettings() {
  const minimizeToTray = useSettingsStore(s => s.minimizeToTray)

  useEffect(() => {
    setMinimizeToTray(minimizeToTray).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

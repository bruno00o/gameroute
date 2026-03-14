import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type SettingsStore = {
  autoStartMonitoring: boolean
  setAutoStartMonitoring: (value: boolean) => void
  onboardingCompleted: boolean
  setOnboardingCompleted: (value: boolean) => void
  minimizeToTray: boolean
  setMinimizeToTray: (value: boolean) => void
  advancedMode: boolean
  setAdvancedMode: (value: boolean) => void
  /**
   * Monotonic counter incremented on locale change. Used as a React `key` on the
   * root SidebarProvider in `__root.tsx` to force a full re-render of the component
   * tree when the language changes, since Paraglide JS messages are plain function
   * calls (not reactive state) and won't trigger re-renders on their own.
   * Not persisted — starts at 0 on each app launch.
   */
  _localeVersion: number
  bumpLocaleVersion: () => void
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    set => ({
      autoStartMonitoring: true,
      setAutoStartMonitoring: value => set({ autoStartMonitoring: value }),
      onboardingCompleted: false,
      setOnboardingCompleted: value => set({ onboardingCompleted: value }),
      minimizeToTray: true,
      setMinimizeToTray: value => {
        set({ minimizeToTray: value })
        invoke('set_minimize_to_tray', { enabled: value }).catch(() => {})
      },
      advancedMode: false,
      setAdvancedMode: value => set({ advancedMode: value }),
      _localeVersion: 0,
      bumpLocaleVersion: () => set(s => ({ _localeVersion: s._localeVersion + 1 })),
    }),
    {
      name: 'gameroute-settings',
      partialize: s => ({
        autoStartMonitoring: s.autoStartMonitoring,
        onboardingCompleted: s.onboardingCompleted,
        minimizeToTray: s.minimizeToTray,
        advancedMode: s.advancedMode,
      }),
    }
  )
)

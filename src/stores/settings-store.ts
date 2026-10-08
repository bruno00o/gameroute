import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { setMinimizeToTray } from '@/lib/tauri'

type SettingsStore = {
  autoStartMonitoring: boolean
  setAutoStartMonitoring: (value: boolean) => void
  onboardingCompleted: boolean
  setOnboardingCompleted: (value: boolean) => void
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

type PersistedSettings = Pick<
  SettingsStore,
  'autoStartMonitoring' | 'onboardingCompleted' | 'advancedMode'
>

export function migrateSettings(persisted: unknown, version: number): PersistedSettings {
  const { minimizeToTray, ...settings } = (persisted ?? {}) as Partial<PersistedSettings> & {
    minimizeToTray?: boolean
  }
  if (version < 1 && minimizeToTray === false) setMinimizeToTray(false).catch(() => {})
  return settings as PersistedSettings
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    set => ({
      autoStartMonitoring: true,
      setAutoStartMonitoring: value => set({ autoStartMonitoring: value }),
      onboardingCompleted: false,
      setOnboardingCompleted: value => set({ onboardingCompleted: value }),
      advancedMode: false,
      setAdvancedMode: value => set({ advancedMode: value }),
      _localeVersion: 0,
      bumpLocaleVersion: () => set(s => ({ _localeVersion: s._localeVersion + 1 })),
    }),
    {
      name: 'gameroute-settings',
      version: 1,
      migrate: migrateSettings,
      partialize: (s): PersistedSettings => ({
        autoStartMonitoring: s.autoStartMonitoring,
        onboardingCompleted: s.onboardingCompleted,
        advancedMode: s.advancedMode,
      }),
    }
  )
)

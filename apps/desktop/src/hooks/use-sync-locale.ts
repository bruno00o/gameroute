import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { getLocale } from '@/paraglide/runtime'
import { setLocale } from '@/lib/tauri'
import { APP_SETTINGS_KEY, useAppSettings } from '@/hooks/use-app-settings'
import { useSettingsStore } from '@/stores/settings-store'

export function useSyncLocale() {
  const localeVersion = useSettingsStore(s => s._localeVersion)
  const queryClient = useQueryClient()
  const { data: settings } = useAppSettings()
  const locale = getLocale()

  useEffect(() => {
    if (!settings || settings.locale === locale) return
    setLocale(locale)
      .then(saved => queryClient.setQueryData(APP_SETTINGS_KEY, saved))
      .catch(e => console.warn('[settings] Could not save the language:', e))
  }, [settings, locale, localeVersion, queryClient])
}

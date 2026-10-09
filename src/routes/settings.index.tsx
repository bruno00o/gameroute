import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { RiLoopLeftLine } from '@remixicon/react'
import { getVersion } from '@tauri-apps/api/app'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { getLocale, locales, setLocale } from '@/paraglide/runtime'
import { openLogDir, setMinimizeToTray } from '@/lib/tauri'
import { checkForAppUpdates, useUpdateStore } from '@/lib/updater'
import { formatClock } from '@/lib/format'
import { useAppSettings, useSaveAppSetting } from '@/hooks/use-app-settings'
import { useSettingsStore } from '@/stores/settings-store'
import { useTheme } from '@/components/use-theme'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { SwitchField } from '@/components/ui/switch'
import { MiniWindowSettings } from '@/components/settings/mini-window-settings'
import { SettingRow, SettingsSection } from '@/components/settings/settings-section'

export const Route = createFileRoute('/settings/')({
  component: GeneralSettings,
})

type Theme = 'dark' | 'light' | 'system'

const localeLabels: Record<(typeof locales)[number], () => string> = {
  en: m.settings_language_en,
  fr: m.settings_language_fr,
  es: m.settings_language_es,
}

function GeneralSettings() {
  return (
    <>
      <SettingsSection title={m.settings_display_title()}>
        <LanguageSetting />
        <ThemeSetting />
        <DetailedViewSetting />
      </SettingsSection>
      <SettingsSection title={m.settings_startup_title()}>
        <LaunchOnStartupSetting />
        <AutoStartSetting />
        <MinimizeToTraySetting />
      </SettingsSection>
      <MiniWindowSettings />
      <SettingsSection title={m.settings_maintenance_title()}>
        <VersionSetting />
        <ReplayOnboardingSetting />
        <OpenLogsSetting />
      </SettingsSection>
    </>
  )
}

function LanguageSetting() {
  const bumpLocaleVersion = useSettingsStore(s => s.bumpLocaleVersion)

  const handleChange = (locale: (typeof locales)[number]) => {
    setLocale(locale, { reload: false })
    bumpLocaleVersion()
  }

  return (
    <SettingRow label={m.settings_language()} description={m.settings_language_description()}>
      <Segmented
        label={m.settings_language()}
        value={getLocale()}
        onValueChange={handleChange}
        options={locales.map(locale => ({ value: locale, label: localeLabels[locale]() }))}
      />
    </SettingRow>
  )
}

function ThemeSetting() {
  const { theme, setTheme } = useTheme()

  return (
    <SettingRow label={m.settings_theme()} description={m.settings_theme_description()}>
      <Segmented<Theme>
        label={m.settings_theme()}
        value={theme}
        onValueChange={setTheme}
        options={[
          { value: 'dark', label: m.settings_theme_dark() },
          { value: 'light', label: m.settings_theme_light() },
          { value: 'system', label: m.settings_theme_system() },
        ]}
      />
    </SettingRow>
  )
}

function DetailedViewSetting() {
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const setAdvancedMode = useSettingsStore(s => s.setAdvancedMode)

  return (
    <SwitchField
      label={m.settings_detailed_view()}
      description={m.settings_detailed_view_description()}
      checked={advancedMode}
      onCheckedChange={setAdvancedMode}
    />
  )
}

function LaunchOnStartupSetting() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    isEnabled()
      .then(setEnabled)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleToggle = async (value: boolean) => {
    try {
      if (value) await enable()
      else await disable()
      setEnabled(value)
    } catch {
      toast.error(m.settings_launch_on_startup_error())
    }
  }

  return (
    <SwitchField
      label={m.settings_launch_on_startup()}
      description={m.settings_launch_on_startup_description()}
      checked={enabled}
      onCheckedChange={handleToggle}
      disabled={loading}
    />
  )
}

function AutoStartSetting() {
  const autoStart = useSettingsStore(s => s.autoStartMonitoring)
  const setAutoStart = useSettingsStore(s => s.setAutoStartMonitoring)

  return (
    <SwitchField
      label={m.settings_auto_start()}
      description={m.settings_auto_start_description()}
      checked={autoStart}
      onCheckedChange={setAutoStart}
    />
  )
}

function MinimizeToTraySetting() {
  const { data: settings } = useAppSettings()
  const save = useSaveAppSetting(setMinimizeToTray)
  const checked = save.isPending ? save.variables : settings?.minimizeToTray

  return (
    <SwitchField
      label={m.settings_minimize_to_tray()}
      description={m.settings_minimize_to_tray_description()}
      checked={checked ?? true}
      onCheckedChange={value => save.mutate(value)}
      disabled={!settings}
    />
  )
}

function VersionSetting() {
  const [isChecking, setIsChecking] = useState(false)
  const checkedAt = useUpdateStore(s => s.checkedAt)
  const { data: version } = useQuery({
    queryKey: ['app-version'],
    queryFn: getVersion,
    staleTime: Infinity,
  })

  const handleCheck = async () => {
    setIsChecking(true)
    try {
      const hasUpdate = await checkForAppUpdates()
      if (!hasUpdate) toast.success(m.settings_no_updates())
    } catch {
      toast.error(m.settings_updates_error())
    } finally {
      setIsChecking(false)
    }
  }

  const description = [
    m.settings_version_description(),
    checkedAt && m.settings_version_checked({ time: formatClock(checkedAt) }),
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <SettingRow label={m.settings_version({ version: version ?? '…' })} description={description}>
      <Button size="sm" loading={isChecking} onClick={handleCheck}>
        <RiLoopLeftLine data-icon="inline-start" />
        {m.settings_check_updates_button()}
      </Button>
    </SettingRow>
  )
}

function ReplayOnboardingSetting() {
  const setOnboardingCompleted = useSettingsStore(s => s.setOnboardingCompleted)
  const navigate = useNavigate()

  return (
    <SettingRow
      label={m.settings_replay_onboarding()}
      description={m.settings_replay_onboarding_description()}
    >
      <Button
        size="sm"
        onClick={() => {
          setOnboardingCompleted(false)
          navigate({ to: '/welcome' })
        }}
      >
        {m.settings_replay_onboarding_button()}
      </Button>
    </SettingRow>
  )
}

function OpenLogsSetting() {
  return (
    <SettingRow label={m.settings_open_logs()} description={m.settings_open_logs_description()}>
      <Button size="sm" onClick={() => openLogDir()}>
        {m.settings_open_logs_button()}
      </Button>
    </SettingRow>
  )
}

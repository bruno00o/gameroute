import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RiArrowDownSLine, RiDeleteBinLine, RiFilterLine } from '@remixicon/react'
import { toast } from 'sonner'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

import * as m from '@/paraglide/messages'
import { getLocale, setLocale, locales } from '@/paraglide/runtime'
import { useTheme } from '@/components/use-theme'
import { useSettingsStore } from '@/stores/settings-store'
import { clearIpMetadataCache, getIpMetadataStats, openLogDir, pruneIpMetadataCache } from '@/lib/tauri'
import { checkForAppUpdates } from '@/lib/updater'
import { formatDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Separator } from '@/components/ui/separator'
import { SwitchField } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_settings_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_settings_description()}</p>

      <div className="mt-6 max-w-xl space-y-6">
        <SectionTitle>{m.settings_section_general()}</SectionTitle>
        <LanguageSetting />
        <ThemeSetting />
        <AutoStartSetting />
        <LaunchOnStartupSetting />
        <MinimizeToTraySetting />
        <DetailedViewSetting />
        <CheckUpdatesSetting />
        <ReplayOnboardingSetting />
        <OpenLogsSetting />
        <Separator />
        <SectionTitle>{m.settings_section_cache()}</SectionTitle>
        <CacheSection />
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold tracking-wide uppercase">{children}</h2>
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-ui font-[560]">{label}</p>
        <p className="mt-0.5 max-w-[52ch] text-label font-normal text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const localeLabels: Record<(typeof locales)[number], () => string> = {
  en: m.settings_language_en,
  fr: m.settings_language_fr,
  es: m.settings_language_es,
}

type Theme = 'dark' | 'light' | 'system'

function LanguageSetting() {
  const currentLocale = getLocale()
  const bumpLocaleVersion = useSettingsStore(s => s.bumpLocaleVersion)

  const handleChange = (locale: (typeof locales)[number]) => {
    setLocale(locale, { reload: false })
    bumpLocaleVersion()
  }

  return (
    <SettingRow label={m.settings_language()} description={m.settings_language_description()}>
      <Segmented
        label={m.settings_language()}
        value={currentLocale}
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
          { value: 'light', label: m.settings_theme_light() },
          { value: 'dark', label: m.settings_theme_dark() },
          { value: 'system', label: m.settings_theme_system() },
        ]}
      />
    </SettingRow>
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

function MinimizeToTraySetting() {
  const minimizeToTray = useSettingsStore(s => s.minimizeToTray)
  const setMinimizeToTray = useSettingsStore(s => s.setMinimizeToTray)

  return (
    <SwitchField
      label={m.settings_minimize_to_tray()}
      description={m.settings_minimize_to_tray_description()}
      checked={minimizeToTray}
      onCheckedChange={setMinimizeToTray}
    />
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

function CheckUpdatesSetting() {
  const [isChecking, setIsChecking] = useState(false)

  return (
    <SettingRow
      label={m.settings_check_updates()}
      description={m.settings_check_updates_description()}
    >
      <Button
        size="sm"
        loading={isChecking}
        onClick={async () => {
          setIsChecking(true)
          try {
            const hasUpdate = await checkForAppUpdates()
            if (!hasUpdate) toast.info(m.settings_no_updates())
          } catch {
            toast.error(m.settings_cache_error())
          } finally {
            setIsChecking(false)
          }
        }}
      >
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
    <SettingRow
      label={m.settings_open_logs()}
      description={m.settings_open_logs_description()}
    >
      <Button size="sm" onClick={() => openLogDir()}>
        {m.settings_open_logs_button()}
      </Button>
    </SettingRow>
  )
}

function CacheSection() {
  const queryClient = useQueryClient()

  const { data: stats, isLoading } = useQuery({
    queryKey: ['ip-metadata-stats'],
    queryFn: getIpMetadataStats,
    staleTime: 0,
  })

  const clearMutation = useMutation({
    mutationFn: clearIpMetadataCache,
    onSuccess: () => {
      toast.success(m.settings_cache_cleared())
      queryClient.invalidateQueries({ queryKey: ['ip-metadata-stats'] })
    },
    onError: () => toast.error(m.settings_cache_error()),
  })

  const pruneMutation = useMutation({
    mutationFn: pruneIpMetadataCache,
    onSuccess: result => {
      toast.success(m.settings_cache_pruned({ count: String(result.entriesDeleted) }))
      queryClient.invalidateQueries({ queryKey: ['ip-metadata-stats'] })
    },
    onError: () => toast.error(m.settings_cache_error()),
  })

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-xs">{m.settings_cache_description()}</p>

      {isLoading ? (
        <div className="text-muted-foreground text-xs">{m.settings_cache_no_stats()}</div>
      ) : stats ? (
        <>
          <div className="text-xs">
            <StatRow label={m.settings_cache_sqlite_entries()} value={stats.sqliteEntries} />
          </div>
          <Collapsible>
            <CollapsibleTrigger className="text-muted-foreground flex items-center gap-1 text-xs hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
              {m.settings_cache_details()}
              <RiArrowDownSLine className="size-4 transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <StatRow label={m.settings_cache_memory_entries()} value={stats.memoryEntries} />
                <StatRow label={m.settings_cache_sqlite_entries()} value={stats.sqliteEntries} />
                <StatRow label={m.settings_cache_with_asn()} value={stats.entriesWithAsn} />
                <StatRow label={m.settings_cache_with_geo()} value={stats.entriesWithGeo} />
                {stats.oldestEntry && (
                  <div className="col-span-2 flex justify-between">
                    <span className="text-muted-foreground">{m.settings_cache_oldest()}</span>
                    <span className="tabular-nums">{formatDate(stats.oldestEntry)}</span>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : (
        <div className="text-muted-foreground text-xs">{m.settings_cache_no_stats()}</div>
      )}

      <div className="flex gap-2">
        <Button size="sm" loading={pruneMutation.isPending} onClick={() => pruneMutation.mutate()}>
          <RiFilterLine data-icon="inline-start" />
          {m.settings_cache_prune()}
        </Button>
        <Button size="sm" loading={clearMutation.isPending} onClick={() => clearMutation.mutate()}>
          <RiDeleteBinLine data-icon="inline-start" />
          {m.settings_cache_clear()}
        </Button>
      </div>
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RiDeleteBinLine, RiFilterLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { getLocale, setLocale, locales } from '@/paraglide/runtime'
import { useTheme } from '@/components/use-theme'
import { useSettingsStore } from '@/stores/settings-store'
import { clearIpMetadataCache, getIpMetadataStats, pruneIpMetadataCache } from '@/lib/tauri'
import { formatDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

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
        <MinimizeToTraySetting />
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
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

const localeLabels: Record<string, () => string> = {
  en: m.settings_language_en,
  fr: m.settings_language_fr,
  es: m.settings_language_es,
}

function LanguageSetting() {
  const currentLocale = getLocale()
  const bumpLocaleVersion = useSettingsStore(s => s.bumpLocaleVersion)

  const handleChange = (val: string | null) => {
    if (!val) return
    setLocale(val as (typeof locales)[number], { reload: false })
    bumpLocaleVersion()
  }

  return (
    <SettingRow label={m.settings_language()} description={m.settings_language_description()}>
      <Select value={currentLocale} onValueChange={handleChange}>
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {locales.map(locale => (
            <SelectItem key={locale} value={locale}>
              {localeLabels[locale]?.() ?? locale}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

function ThemeSetting() {
  const { theme, setTheme } = useTheme()

  return (
    <SettingRow label={m.settings_theme()} description={m.settings_theme_description()}>
      <Select value={theme} onValueChange={val => setTheme(val as 'dark' | 'light' | 'system')}>
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">{m.settings_theme_light()}</SelectItem>
          <SelectItem value="dark">{m.settings_theme_dark()}</SelectItem>
          <SelectItem value="system">{m.settings_theme_system()}</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
  )
}

function AutoStartSetting() {
  const autoStart = useSettingsStore(s => s.autoStartMonitoring)
  const setAutoStart = useSettingsStore(s => s.setAutoStartMonitoring)

  return (
    <SettingRow label={m.settings_auto_start()} description={m.settings_auto_start_description()}>
      <Switch checked={autoStart} onCheckedChange={setAutoStart} />
    </SettingRow>
  )
}

function MinimizeToTraySetting() {
  const minimizeToTray = useSettingsStore(s => s.minimizeToTray)
  const setMinimizeToTray = useSettingsStore(s => s.setMinimizeToTray)

  return (
    <SettingRow
      label={m.settings_minimize_to_tray()}
      description={m.settings_minimize_to_tray_description()}
    >
      <Switch checked={minimizeToTray} onCheckedChange={setMinimizeToTray} />
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
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
      ) : (
        <div className="text-muted-foreground text-xs">{m.settings_cache_no_stats()}</div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => pruneMutation.mutate()}>
          <RiFilterLine className="size-3.5" data-icon="inline-start" />
          {m.settings_cache_prune()}
        </Button>
        <Button variant="destructive" size="sm" onClick={() => clearMutation.mutate()}>
          <RiDeleteBinLine className="size-3.5" data-icon="inline-start" />
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

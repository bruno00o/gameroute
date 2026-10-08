import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiDeleteBinLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import {
  clearIpMetadataCache,
  deleteAllData,
  getIpMetadataStats,
  getStorageStats,
  pruneIpMetadataCache,
  setSessionRetention,
} from '@/lib/tauri'
import { formatBytes, formatDay, formatNumber } from '@/lib/format'
import { useAppSettings, useSaveAppSetting } from '@/hooks/use-app-settings'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Fact, FactRow } from '@/components/fact-row'
import { SettingRow, SettingsSection } from '@/components/settings/settings-section'

export const Route = createFileRoute('/settings/privacy')({
  component: PrivacySettings,
})

const STORAGE_STATS_KEY = ['storage-stats']
const CACHE_STATS_KEY = ['ip-metadata-stats']
const FOREVER = 'forever'

type RetentionChoice = '90' | '180' | '365' | '730' | typeof FOREVER

const retentionOptions: { value: RetentionChoice; label: () => string }[] = [
  { value: '90', label: m.settings_retention_3_months },
  { value: '180', label: m.settings_retention_6_months },
  { value: '365', label: m.settings_retention_1_year },
  { value: '730', label: m.settings_retention_2_years },
  { value: FOREVER, label: m.settings_retention_forever },
]

function PrivacySettings() {
  return (
    <>
      <SettingsSection
        title={m.settings_local_title()}
        description={
          <>
            <p>{m.settings_local_description()}</p>
            <p>{m.settings_local_connections()}</p>
          </>
        }
      >
        <StorageFacts />
        <RetentionSetting />
        <CacheSetting />
      </SettingsSection>
      <DeleteEverything />
    </>
  )
}

function StorageFacts() {
  const { data: stats } = useQuery({ queryKey: STORAGE_STATS_KEY, queryFn: getStorageStats })

  return (
    <FactRow>
      <Fact label={m.settings_storage_database()}>{stats && formatBytes(stats.databaseBytes)}</Fact>
      <Fact label={m.settings_storage_sessions()}>{stats && formatNumber(stats.sessionCount)}</Fact>
      <Fact label={m.settings_storage_addresses()}>
        {stats && formatNumber(stats.addressCount)}
      </Fact>
      <Fact label={m.settings_storage_geolite()}>
        {stats?.geoliteBuiltAt && formatDay(stats.geoliteBuiltAt)}
      </Fact>
    </FactRow>
  )
}

function RetentionSetting() {
  const { data: settings } = useAppSettings()
  const save = useSaveAppSetting(setSessionRetention)
  const days = save.isPending ? save.variables : settings?.sessionRetentionDays
  const value: RetentionChoice | undefined =
    days === undefined ? undefined : days === null ? FOREVER : (String(days) as RetentionChoice)

  return (
    <SettingRow
      label={m.settings_retention()}
      description={
        value === FOREVER
          ? m.settings_retention_forever_description()
          : m.settings_retention_description()
      }
    >
      {value && (
        <Segmented<RetentionChoice>
          label={m.settings_retention()}
          value={value}
          onValueChange={next => save.mutate(next === FOREVER ? null : Number(next))}
          options={retentionOptions.map(option => ({
            value: option.value,
            label: option.label(),
          }))}
        />
      )}
    </SettingRow>
  )
}

function CacheSetting() {
  const queryClient = useQueryClient()
  const { data: stats } = useQuery({ queryKey: CACHE_STATS_KEY, queryFn: getIpMetadataStats })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: CACHE_STATS_KEY })
    queryClient.invalidateQueries({ queryKey: STORAGE_STATS_KEY })
  }

  const prune = useMutation({
    mutationFn: pruneIpMetadataCache,
    onSuccess: result => {
      toast.success(m.settings_cache_pruned({ count: formatNumber(result.entriesDeleted) }))
      refresh()
    },
    onError: () => toast.error(m.settings_cache_error()),
  })

  const clear = useMutation({
    mutationFn: clearIpMetadataCache,
    onSuccess: () => {
      toast.success(m.settings_cache_cleared())
      refresh()
    },
    onError: () => toast.error(m.settings_cache_error()),
  })

  const count = stats?.sqliteEntries
  const entries =
    count === undefined
      ? null
      : (count === 1 ? m.settings_cache_entries_one : m.settings_cache_entries_other)({
          count: formatNumber(count),
        })

  return (
    <SettingRow
      label={m.settings_cache()}
      description={[entries, m.settings_cache_description()].filter(Boolean).join(' ')}
    >
      <Button size="sm" loading={prune.isPending} onClick={() => prune.mutate()}>
        {m.settings_cache_prune()}
      </Button>
      <Button size="sm" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>
        {m.settings_cache_clear()}
      </Button>
    </SettingRow>
  )
}

function DeleteEverything() {
  const queryClient = useQueryClient()
  const isMonitoring = useMonitoringStore(s => s.isMonitoring)
  const [confirming, setConfirming] = useState(false)

  const wipe = useMutation({
    mutationFn: deleteAllData,
    onSuccess: () => {
      toast.success(m.settings_wipe_done())
      queryClient.invalidateQueries()
    },
    onError: () => toast.error(m.settings_wipe_error()),
    onSettled: () => setConfirming(false),
  })

  return (
    <SettingsSection title={m.settings_wipe_title()}>
      <SettingRow
        description={
          isMonitoring
            ? `${m.settings_wipe_description()} ${m.settings_wipe_monitoring()}`
            : m.settings_wipe_description()
        }
      >
        <Button
          size="sm"
          variant="danger"
          disabled={isMonitoring}
          loading={wipe.isPending}
          onClick={() => setConfirming(true)}
        >
          <RiDeleteBinLine data-icon="inline-start" />
          {m.settings_wipe_button()}
        </Button>
      </SettingRow>
      <AlertDialog open={confirming} onOpenChange={open => !wipe.isPending && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.settings_wipe_dialog_title()}</AlertDialogTitle>
            <AlertDialogDescription>{m.settings_wipe_dialog_description()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={wipe.isPending}>
              {m.settings_wipe_cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              loading={wipe.isPending}
              onClick={() => wipe.mutate()}
            >
              {m.settings_wipe_confirm()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}

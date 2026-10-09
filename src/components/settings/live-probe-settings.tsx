import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { getLiveProbeConfig, setLiveProbeConfig } from '@/lib/tauri'
import { useSettingsStore } from '@/stores/settings-store'
import type { LiveProbeConfig } from '@/types/backend'
import { SettingsSection } from '@/components/settings/settings-section'
import { SwitchField } from '@/components/ui/switch'

const LIVE_PROBE_CONFIG_KEY = ['live-probe-config']

function LiveProbeSettings() {
  const queryClient = useQueryClient()
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const { data: config } = useQuery({
    queryKey: LIVE_PROBE_CONFIG_KEY,
    queryFn: getLiveProbeConfig,
  })
  const save = useMutation({
    mutationFn: setLiveProbeConfig,
    onSuccess: saved => queryClient.setQueryData(LIVE_PROBE_CONFIG_KEY, saved),
    onError: () => toast.error(m.settings_save_error()),
  })

  const update = (patch: Partial<LiveProbeConfig>) => {
    if (config) save.mutate({ ...config, ...patch })
  }

  const toggleBeacon = (id: string, enabled: boolean) => {
    if (!config) return
    save.mutate({
      ...config,
      beacons: config.beacons.map(b => (b.id === id ? { ...b, enabled } : b)),
    })
  }

  return (
    <SettingsSection
      title={m.settings_probes_title()}
      description={<p>{m.settings_probes_description()}</p>}
    >
      <SwitchField
        label={m.settings_probes_floor()}
        description={m.settings_probes_floor_description()}
        checked={!!config && config.enabled && config.floor}
        onCheckedChange={value => update(value ? { enabled: true, floor: true } : { floor: false })}
        disabled={!config}
      />
      <SwitchField
        label={m.settings_probes_region()}
        description={m.settings_probes_region_description()}
        checked={!!config && config.enabled && config.region}
        onCheckedChange={value =>
          update(value ? { enabled: true, region: true } : { region: false })
        }
        disabled={!config}
      />
      <SwitchField
        label={m.settings_probes_zones()}
        description={m.settings_probes_zones_description()}
        checked={!!config && config.enabled && config.zones}
        onCheckedChange={value => update(value ? { enabled: true, zones: true } : { zones: false })}
        disabled={!config}
      />
      {advancedMode && config && config.beacons.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-label text-muted-foreground font-stretch-[92%]">
            {m.settings_probes_beacons()}
          </h3>
          {config.beacons.map(beacon => (
            <SwitchField
              key={beacon.id}
              label={`${beacon.provider} · ${beacon.region}`}
              description={beacon.host}
              checked={beacon.enabled}
              onCheckedChange={value => toggleBeacon(beacon.id, value)}
              disabled={!config.region}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  )
}

export { LiveProbeSettings }

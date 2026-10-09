import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import type { AlertSettings, RecapMode, Severity } from '@/types/backend'
import { getSeverityThresholds, setAlertSettings } from '@/lib/tauri'
import { formatMs, formatPercent } from '@/lib/format'
import { useAppSettings, useSaveAppSetting } from '@/hooks/use-app-settings'
import { StatusPill } from '@/components/status/status-pill'
import { Segmented } from '@/components/ui/segmented'
import { SwitchField } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SettingRow, SettingsSection } from '@/components/settings/settings-section'

export const Route = createFileRoute('/settings/alerts')({
  component: AlertSettingsScreen,
})

const CRITICAL_ALERT_SECONDS = 30

const recapOptions: { value: RecapMode; label: () => string }[] = [
  { value: 'always', label: m.alerts_recap_always },
  { value: 'changed', label: m.alerts_recap_changed },
  { value: 'never', label: m.alerts_recap_never },
]

const thresholdRows: Exclude<Severity, 'ok' | 'unmeasured'>[] = ['watch', 'degraded', 'critical']

function useThresholds() {
  return useQuery({
    queryKey: ['severity-thresholds'],
    queryFn: getSeverityThresholds,
    staleTime: Infinity,
  })
}

function percent(value: number) {
  return formatPercent(value, { digits: Number.isInteger(value) ? 0 : 1 })
}

function AlertSettingsScreen() {
  const { data: settings } = useAppSettings()
  const save = useSaveAppSetting(setAlertSettings)
  const alerts = save.isPending ? save.variables : settings?.alerts

  const change = (patch: Partial<AlertSettings>) => {
    if (alerts) save.mutate({ ...alerts, ...patch })
  }

  return (
    <>
      <SettingsSection
        title={m.alerts_during_title()}
        description={<p>{m.alerts_during_description()}</p>}
      >
        <CriticalAlertField
          checked={alerts?.criticalAlert ?? true}
          disabled={!alerts}
          onChange={value => change({ criticalAlert: value })}
        />
        <SwitchField
          label={m.alerts_dnd()}
          description={m.alerts_dnd_description()}
          checked={alerts?.doNotDisturb ?? false}
          onCheckedChange={value => change({ doNotDisturb: value })}
          disabled={!alerts}
        />
      </SettingsSection>
      <SettingsSection title={m.alerts_after_title()}>
        <SettingRow label={m.alerts_recap()} description={m.alerts_recap_description()}>
          {alerts && (
            <Segmented<RecapMode>
              label={m.alerts_recap()}
              value={alerts.recap}
              onValueChange={recap => change({ recap })}
              options={recapOptions.map(option => ({
                value: option.value,
                label: option.label(),
              }))}
            />
          )}
        </SettingRow>
      </SettingsSection>
      <Thresholds />
    </>
  )
}

function CriticalAlertField({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  const { data: thresholds } = useThresholds()
  const critical = thresholds?.critical

  return (
    <SwitchField
      label={m.alerts_critical()}
      description={
        critical
          ? m.alerts_critical_description({
              seconds: CRITICAL_ALERT_SECONDS,
              loss: percent(critical.lossPct),
              jitter: formatMs(critical.jitterMs, { digits: 0 }),
              over: formatMs(critical.overBaselineMs, { digits: 0 }),
            })
          : undefined
      }
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
    />
  )
}

function Thresholds() {
  const { data: thresholds } = useThresholds()
  if (!thresholds) return null

  return (
    <SettingsSection
      title={m.alerts_thresholds_title()}
      description={<p>{m.alerts_thresholds_description()}</p>}
    >
      <Table aria-label={m.alerts_thresholds_label()}>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead>{m.alerts_threshold_loss()}</TableHead>
            <TableHead>{m.alerts_threshold_jitter()}</TableHead>
            <TableHead>{m.alerts_threshold_over()}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {thresholdRows.map(status => {
            const threshold = thresholds[status]
            return (
              <TableRow key={status}>
                <TableCell>
                  <StatusPill status={status} size="sm" />
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {`≥ ${percent(threshold.lossPct)}`}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {`≥ ${formatMs(threshold.jitterMs, { digits: 0 })}`}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {`+${formatMs(threshold.overBaselineMs, { digits: 0 })}`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </SettingsSection>
  )
}

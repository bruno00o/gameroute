import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { RiLoopLeftLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { restartCaptureService } from '@/lib/tauri'
import { useServiceHealthCheck } from '@/hooks/use-service-health-check'
import { Button } from '@/components/ui/button'
import { SettingRow, SettingsSection } from '@/components/settings/settings-section'
import { LiveProbeSettings } from '@/components/settings/live-probe-settings'

export const Route = createFileRoute('/settings/capture')({
  component: CaptureSettings,
})

function CaptureSettings() {
  const { isServiceRunning, isLoading } = useServiceHealthCheck()
  const queryClient = useQueryClient()
  const [isRestarting, setIsRestarting] = useState(false)

  const handleRestart = async () => {
    setIsRestarting(true)
    try {
      await restartCaptureService()
      toast.success(m.service_warning_fix_success())
      await queryClient.invalidateQueries({ queryKey: ['capture-service-status'] })
    } catch {
      toast.error(m.service_warning_fix_error())
    } finally {
      setIsRestarting(false)
    }
  }

  const status = isLoading
    ? m.settings_capture_checking()
    : isServiceRunning
      ? m.settings_capture_running()
      : m.settings_capture_stopped()

  return (
    <>
      <SettingsSection
        title={m.settings_capture_title()}
        description={<p>{m.settings_capture_description()}</p>}
      >
        <div className="flex flex-col gap-1.5">
          <h3 className="text-label text-muted-foreground font-stretch-[92%]">
            {m.settings_capture_features()}
          </h3>
          <ul className="text-ui text-foreground flex list-disc flex-col gap-1 pl-[18px]">
            <li>{m.settings_capture_feature_servers()}</li>
            <li>{m.settings_capture_feature_voice()}</li>
            <li>{m.settings_capture_feature_probes()}</li>
          </ul>
        </div>
        <SettingRow label={m.settings_capture_status()} description={status}>
          {!isLoading && !isServiceRunning && (
            <Button size="sm" loading={isRestarting} onClick={handleRestart}>
              <RiLoopLeftLine data-icon="inline-start" />
              {m.service_warning_fix()}
            </Button>
          )}
        </SettingRow>
      </SettingsSection>
      <LiveProbeSettings />
    </>
  )
}

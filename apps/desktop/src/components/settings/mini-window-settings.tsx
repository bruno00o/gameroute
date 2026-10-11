import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { MiniState } from '@/types/backend'
import { getMiniState, setMiniAlwaysOnTop, showMiniWindow } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { SwitchField } from '@/components/ui/switch'
import { SettingRow, SettingsSection } from '@/components/settings/settings-section'

const MINI_STATE_KEY = ['mini-state'] as const

export function MiniWindowSettings() {
  const queryClient = useQueryClient()
  const { data: state } = useQuery({ queryKey: MINI_STATE_KEY, queryFn: getMiniState })
  const saveState = (next: MiniState) => queryClient.setQueryData(MINI_STATE_KEY, next)
  const show = useMutation({
    mutationFn: showMiniWindow,
    onSuccess: saveState,
    onError: () => toast.error(m.settings_mini_show_error()),
  })
  const onTop = useMutation({
    mutationFn: setMiniAlwaysOnTop,
    onSuccess: saveState,
    onError: () => toast.error(m.settings_save_error()),
  })
  const alwaysOnTop = onTop.isPending ? onTop.variables : state?.alwaysOnTop

  return (
    <SettingsSection title={m.settings_mini_title()} description={m.settings_mini_description()}>
      <SettingRow description={m.settings_mini_show_description()}>
        <Button size="sm" loading={show.isPending} onClick={() => show.mutate()}>
          {m.settings_mini_show()}
        </Button>
      </SettingRow>
      <SwitchField
        label={m.settings_mini_on_top()}
        description={m.settings_mini_on_top_description()}
        checked={alwaysOnTop ?? false}
        onCheckedChange={value => onTop.mutate(value)}
        disabled={!state}
      />
    </SettingsSection>
  )
}

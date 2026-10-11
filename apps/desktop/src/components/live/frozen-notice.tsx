import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { RiLoopLeftLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { LiveStatus } from '@/types/backend'
import { ageText, frozenAge } from '@/lib/live'
import { restartCaptureService } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/notice'

function FrozenNotice({ status, serviceBanner }: { status: LiveStatus; serviceBanner: boolean }) {
  const queryClient = useQueryClient()
  const [fixing, setFixing] = useState(false)

  const restart = async () => {
    setFixing(true)
    try {
      await restartCaptureService()
      toast.success(m.service_warning_fix_success())
      queryClient.invalidateQueries({ queryKey: ['capture-service-status'] })
    } catch {
      toast.error(m.service_warning_fix_error())
    } finally {
      setFixing(false)
    }
  }

  if (status.frozenReason === 'capture_service') {
    if (serviceBanner) return null
    return (
      <Notice
        tone="watch"
        title={m.service_warning_title()}
        action={
          <Button size="sm" loading={fixing} onClick={restart}>
            <RiLoopLeftLine data-icon="inline-start" />
            {m.service_warning_fix()}
          </Button>
        }
      >
        {m.live_frozen_service_body()}
      </Notice>
    )
  }

  return (
    <Notice tone="watch" title={m.live_frozen_title({ age: ageText(frozenAge(status)) ?? '—' })}>
      {m.live_frozen_body()}
    </Notice>
  )
}

export { FrozenNotice }

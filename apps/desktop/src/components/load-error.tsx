import { RiLoopLeftLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { openLogDir } from '@/lib/tauri'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/notice'

type LoadErrorProps = {
  title: string
  retrying: boolean
  onRetry: () => void
}

function LoadError({ title, retrying, onRetry }: LoadErrorProps) {
  return (
    <Notice
      tone="critical"
      title={title}
      action={
        <>
          <Button size="sm" loading={retrying} onClick={onRetry}>
            <RiLoopLeftLine data-icon="inline-start" />
            {m.sessions_error_retry()}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openLogDir().catch(err => toast.error(errorMessage(err)))}
          >
            {m.sessions_error_logs()}
          </Button>
        </>
      }
    >
      {m.sessions_error_body()}
    </Notice>
  )
}

export { LoadError, type LoadErrorProps }

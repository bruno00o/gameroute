import { RiLoopLeftLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { Notice } from '@/components/notice'

function SessionGone({ onBack }: { onBack: () => void }) {
  return (
    <div className="h-full overflow-y-auto p-4 sm:px-6">
      <EmptyState
        title={m.session_gone_title()}
        action={<Button onClick={onBack}>{m.session_back()}</Button>}
      >
        {m.session_gone_body()}
      </EmptyState>
    </div>
  )
}

function SessionLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="h-full overflow-y-auto p-4 sm:px-6">
      <Notice
        tone="critical"
        title={m.session_load_failed()}
        action={
          <Button size="sm" onClick={onRetry}>
            <RiLoopLeftLine data-icon="inline-start" />
            {m.session_try_again()}
          </Button>
        }
      >
        {m.session_load_failed_body()}
      </Notice>
    </div>
  )
}

export { SessionGone, SessionLoadError }

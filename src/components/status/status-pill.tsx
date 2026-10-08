import type { ReactNode } from 'react'

import * as m from '@/paraglide/messages'
import type { Severity } from '@/types/backend'
import { cn } from '@/lib/utils'
import { SeverityGlyph } from '@/components/status/severity-glyph'

const labels: Record<Severity, () => string> = {
  ok: m.status_ok,
  watch: m.status_watch,
  degraded: m.status_degraded,
  critical: m.status_critical,
  unmeasured: m.status_unmeasured,
}

const softFill: Partial<Record<Severity, string>> = {
  degraded: 'bg-degraded-soft text-degraded',
  critical: 'bg-critical-soft text-critical',
}

export function StatusPill({
  status,
  variant = 'plain',
  size = 'md',
  className,
  children,
}: {
  status: Severity
  variant?: 'plain' | 'soft'
  size?: 'sm' | 'md'
  className?: string
  children?: ReactNode
}) {
  const fill = variant === 'soft' ? softFill[status] : undefined

  return (
    <span
      data-slot="status-pill"
      data-status={status}
      className={cn(
        'text-ui inline-flex items-center gap-1.5 font-medium whitespace-nowrap',
        status === 'unmeasured' ? 'text-muted-foreground' : 'text-foreground',
        size === 'sm' && 'text-label gap-[5px]',
        fill &&
          cn(
            'font-stretch-[92%] h-[22px] rounded-full pr-[9px] pl-2 text-xs leading-none font-semibold',
            size === 'sm' && 'h-[18px] pr-[7px] pl-1.5 text-[11px]',
            fill
          ),
        className
      )}
    >
      <SeverityGlyph status={status} size={size === 'sm' ? 8 : 9} />
      <span>{children ?? labels[status]()}</span>
    </span>
  )
}

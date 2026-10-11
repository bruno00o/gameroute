import type { ReactNode } from 'react'

import type { Severity } from '@/types/backend'
import { cn } from '@/lib/utils'
import { severityText } from '@/components/status/severity-color'

const shapes: Record<Severity, ReactNode> = {
  ok: <circle cx={5} cy={5} r={4.5} />,
  watch: (
    <>
      <circle cx={5} cy={5} r={4} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M5 1 A4 4 0 0 0 5 9 Z" />
    </>
  ),
  degraded: <path d="M5 0.6 L9.7 9.2 L0.3 9.2 Z" />,
  critical: <path d="M5 0 L10 5 L5 10 L0 5 Z" />,
  unmeasured: (
    <circle
      cx={5}
      cy={5}
      r={3.9}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeDasharray="2.1 1.6"
    />
  ),
}

export function SeverityGlyph({
  status,
  size = 10,
  className,
}: {
  status: Severity
  size?: number
  className?: string
}) {
  return (
    <svg
      data-slot="severity-glyph"
      data-status={status}
      viewBox="0 0 10 10"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={cn('inline-block shrink-0', severityText[status], className)}
    >
      {shapes[status]}
    </svg>
  )
}

import type { ReportSeverity } from '@gameroute/shared'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const SEVERITY_TEXT: Record<ReportSeverity, string> = {
  ok: 'text-ok',
  watch: 'text-watch',
  degraded: 'text-degraded',
  critical: 'text-critical',
  unmeasured: 'text-subtle-foreground',
}

export const SEVERITY_BG: Partial<Record<ReportSeverity, string>> = {
  watch: 'bg-watch',
  degraded: 'bg-degraded',
  critical: 'bg-critical',
}

const SHAPES: Record<ReportSeverity, ReactNode> = {
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
  status: ReportSeverity
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 10 10"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={cn('inline-block shrink-0', SEVERITY_TEXT[status], className)}
    >
      {SHAPES[status]}
    </svg>
  )
}

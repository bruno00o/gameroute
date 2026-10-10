import { useId, type ReactNode } from 'react'

import * as m from '@/paraglide/messages'
import type { RouteZone, Severity } from '@/types/backend'
import type { VerdictZone } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { SeverityGlyph } from '@/components/status/severity-glyph'

const ZONES: RouteZone[] = ['home', 'isp', 'transit', 'service']

const barColor: Partial<Record<Severity, string>> = {
  watch: 'bg-watch',
  degraded: 'bg-degraded',
  critical: 'bg-critical',
  unmeasured: 'bg-[repeating-linear-gradient(45deg,var(--ink-subtle)_0_2px,transparent_2px_5px)]',
}

const guiltyFill: Partial<Record<Severity, string>> = {
  watch: 'bg-watch-soft',
  degraded: 'bg-degraded-soft',
  critical: 'bg-critical-soft',
}

type VerdictProps = {
  status: Severity
  title: ReactNode
  scope?: ReactNode
  zone?: RouteZone | null
  zones?: Record<RouteZone, VerdictZone> | null
  action?: ReactNode
  children?: ReactNode
  className?: string
}

function Verdict({ status, title, scope, zone, zones, action, children, className }: VerdictProps) {
  const titleId = useId()

  return (
    <section
      data-slot="verdict"
      data-status={status}
      aria-labelledby={titleId}
      className={cn(
        'bg-card grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-5 rounded-sm border p-5',
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        {scope && <p className="text-data-sm text-ink-subtle font-mono tabular-nums">{scope}</p>}
        <h2
          id={titleId}
          className="text-title text-foreground flex items-center gap-2.5 font-stretch-[106%] text-balance"
        >
          <SeverityGlyph status={status} size={14} />
          <span>{title}</span>
        </h2>
        {children && <p className="text-body text-muted-foreground max-w-[62ch]">{children}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {zones && (
        <ol
          aria-label={m.verdict_locator()}
          className="grid grid-cols-4 gap-0.5 self-end max-[420px]:grid-cols-2"
        >
          {ZONES.map(key => {
            const view = zones[key]
            const guilty = zone === key
            return (
              <li
                key={key}
                data-zone={key}
                data-status={view.status ?? undefined}
                aria-current={guilty || undefined}
                className={cn(
                  'bg-muted flex min-w-0 flex-col gap-[3px] px-2.5 pb-2.5',
                  guilty && view.status && guiltyFill[view.status]
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    '-mx-2.5 mb-2 block h-1',
                    (view.status && barColor[view.status]) || 'bg-(--zone)'
                  )}
                />
                <span className="text-label text-foreground font-semibold font-stretch-[92%] [overflow-wrap:anywhere] hyphens-auto">
                  {view.name}
                </span>
                <span className="text-label text-muted-foreground flex items-center gap-[5px] font-normal">
                  {view.status && <SeverityGlyph status={view.status} size={8} />}
                  {view.note}
                </span>
                {guilty && (
                  <span className="text-overline text-foreground mt-0.5 font-stretch-[88%] uppercase">
                    {m.verdict_here()}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export { Verdict, type VerdictProps }

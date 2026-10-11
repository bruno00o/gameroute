import { useEffect, useRef } from 'react'

import * as m from '@/paraglide/messages'
import type { Severity, UsualRoute } from '@/types/backend'
import { destinationName, hasSilentServer, matchesOperator } from '@/lib/route-history'
import { formatRouteMs, segmentName, zoneLabel } from '@/lib/route'
import { cn } from '@/lib/utils'
import { SeverityGlyph } from '@/components/status/severity-glyph'
import { SilentHop } from '@/components/status/silent-hop'

const barColor: Partial<Record<Severity, string>> = {
  watch: 'bg-watch',
  degraded: 'bg-degraded',
  critical: 'bg-critical',
}

const ROW =
  'grid grid-cols-[minmax(96px,168px)_minmax(0,1fr)_minmax(72px,112px)] items-center gap-x-4 gap-y-1 rounded-sm py-2 data-highlighted:bg-muted data-highlighted:-mx-2 data-highlighted:px-2'

type OperatorContributionsProps = {
  usual: UsualRoute
  highlight?: string
  className?: string
}

function OperatorContributions({ usual, highlight, className }: OperatorContributionsProps) {
  const { route } = usual
  const deduced = usual.gamePing?.deducedMs ?? null
  const list = useRef<HTMLUListElement>(null)
  const largest = Math.max(...route.segments.map(segment => segment.addedMs), deduced ?? 0, 1)

  useEffect(() => {
    if (highlight)
      list.current?.querySelector('[data-highlighted]')?.scrollIntoView?.({ block: 'nearest' })
  }, [highlight, usual])

  return (
    <ul
      ref={list}
      data-slot="operator-contributions"
      aria-label={m.route_contrib_label()}
      className={cn('flex flex-col divide-y', className)}
    >
      {route.segments.map(segment => {
        const name = segmentName(segment)
        const status = segment.status && segment.status !== 'ok' ? segment.status : null
        const highlighted = matchesOperator(segment, highlight)

        return (
          <li
            key={`${segment.firstHop}-${segment.lastHop}`}
            data-zone={segment.zone}
            data-status={status ?? undefined}
            data-highlighted={highlighted || undefined}
            aria-current={highlighted || undefined}
            className={ROW}
          >
            <div className="min-w-0">
              <p className="text-overline text-ink-subtle font-stretch-[88%] uppercase">
                {zoneLabel(segment.zone)}
              </p>
              {name && (
                <p className="text-ui text-foreground flex items-center gap-1.5 font-semibold [overflow-wrap:anywhere]">
                  {status && <SeverityGlyph status={status} size={9} />}
                  {name}
                  {segment.asn != null && (
                    <span className="text-data-sm text-ink-subtle font-mono font-normal">
                      AS{segment.asn}
                    </span>
                  )}
                </p>
              )}
            </div>
            <div aria-hidden="true" className="bg-muted h-2">
              <div
                className={cn('h-full', (status && barColor[status]) || 'bg-(--zone)')}
                style={{ width: `${(Math.max(segment.addedMs, 0) / largest) * 100}%` }}
              />
            </div>
            <p className="text-data text-foreground text-right font-mono tabular-nums">
              +{formatRouteMs(segment.addedMs)}
            </p>
          </li>
        )
      })}
      {hasSilentServer(route) && (
        <li
          data-zone="service"
          data-silent="true"
          data-deduced={deduced != null || undefined}
          className={ROW}
        >
          <div className="min-w-0">
            <p className="text-overline text-ink-subtle font-stretch-[88%] uppercase">
              {zoneLabel('service')}
            </p>
            <p className="text-ui text-foreground font-semibold [overflow-wrap:anywhere]">
              {destinationName(usual)}
            </p>
          </div>
          {deduced != null ? (
            <>
              <div aria-hidden="true" className="bg-muted h-2">
                <div
                  className="h-full border border-dashed border-(--zone)"
                  style={{ width: `${(deduced / largest) * 100}%` }}
                />
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <p className="text-data text-foreground text-right font-mono tabular-nums">
                  +{formatRouteMs(deduced)}
                </p>
                <p className="text-label text-ink-subtle text-right font-normal">
                  {m.route_contrib_deduced()}
                </p>
              </div>
            </>
          ) : (
            <>
              <div
                aria-hidden="true"
                className="bg-muted h-2 bg-[repeating-linear-gradient(45deg,var(--ink-subtle)_0_1.5px,transparent_1.5px_4px)]"
              />
              <div className="flex flex-col items-end gap-0.5">
                <p className="text-data-sm text-muted-foreground font-mono">
                  {m.route_contrib_unmeasurable()}
                </p>
                <SilentHop />
              </div>
            </>
          )}
        </li>
      )}
    </ul>
  )
}

export { OperatorContributions, type OperatorContributionsProps }

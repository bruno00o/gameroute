import { useEffect, useRef, useState } from 'react'

import * as m from '@/paraglide/messages'
import type { OperatorRoute, Severity } from '@/types/backend'
import { formatNumber, formatPercent } from '@/lib/format'
import { formatRouteMs, hopCount, segmentName, zoneLabel } from '@/lib/route'
import { cn } from '@/lib/utils'
import { severityText } from '@/components/status/severity-color'
import { SeverityGlyph } from '@/components/status/severity-glyph'

const NBSP = ' '
const SEGMENT_MIN_WIDTH = 106
const FIXED_WIDTH = 290
const MIN_SHARE_MS = 4

const pipeColor: Partial<Record<Severity, string>> = {
  watch: 'bg-watch',
  degraded: 'bg-degraded',
  critical: 'bg-critical',
}

type Orientation = 'auto' | 'horizontal' | 'vertical'

type RouteStripProps = {
  route: OperatorRoute
  destination: { name: string; detail?: string | null }
  persistentLoss?: number | null
  serviceLabel?: string
  orientation?: Orientation
  className?: string
}

function useNarrow(minWidth: number, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!enabled || !element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      if (width > 0) setNarrow(width < minWidth)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [minWidth, enabled])

  return [ref, narrow] as const
}

function RouteStrip({
  route,
  destination,
  persistentLoss,
  serviceLabel,
  orientation = 'auto',
  className,
}: RouteStripProps) {
  const minWidth = Math.max(560, route.segments.length * SEGMENT_MIN_WIDTH + FIXED_WIDTH)
  const [ref, narrow] = useNarrow(minWidth, orientation === 'auto')
  const vertical = orientation === 'vertical' || (orientation === 'auto' && narrow)
  const silent = route.destinationSilent

  return (
    <div
      ref={ref}
      data-slot="route-strip"
      data-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn('flex min-w-0 items-stretch gap-4', vertical && 'flex-col gap-3', className)}
    >
      <ol
        aria-label={m.route_label()}
        className={cn('flex min-w-0 flex-1 gap-0.5', vertical && 'flex-col gap-0')}
      >
        {route.segments.map((segment, i) => {
          const name = segmentName(segment)
          const status = segment.status && segment.status !== 'ok' ? segment.status : null
          const note =
            status && persistentLoss != null
              ? m.route_loss_note({
                  loss: formatPercent(persistentLoss),
                  hop: String(route.lastRespondingHop),
                })
              : null

          return (
            <li
              key={`${segment.firstHop}-${segment.lastHop}`}
              data-zone={segment.zone}
              data-status={status ?? undefined}
              style={vertical ? undefined : { flexGrow: Math.max(segment.addedMs, MIN_SHARE_MS) }}
              className={cn(
                'flex min-w-[104px] flex-[1_1_0] flex-col gap-1.5',
                vertical && 'grid min-w-0 grid-cols-[14px_minmax(0,1fr)] gap-x-3 gap-y-0.5'
              )}
            >
              <p
                className={cn(
                  'text-overline text-ink-subtle font-stretch-[88%] [overflow-wrap:anywhere] uppercase',
                  vertical && 'col-start-2 row-start-1'
                )}
              >
                {zoneLabel(segment.zone, serviceLabel)}
              </p>
              <div
                aria-hidden="true"
                className={cn(
                  'relative flex h-2.5 items-center',
                  vertical && 'col-start-1 row-span-2 row-start-1 h-auto w-3.5 flex-col'
                )}
              >
                <span
                  className={cn(
                    'z-[1] size-2.5 flex-none rounded-full bg-(--zone) shadow-[0_0_0_2px_var(--card)]',
                    vertical ? 'mt-0.5 -mb-0.5' : '-mr-0.5',
                    i === 0 && 'bg-card shadow-[inset_0_0_0_2px_var(--zone),0_0_0_2px_var(--card)]'
                  )}
                />
                <span
                  className={cn(
                    'h-1.5 flex-1',
                    vertical && 'h-auto min-h-7 w-1.5',
                    (status && pipeColor[status]) || 'bg-(--zone)'
                  )}
                />
              </div>
              <div className={cn('min-w-0', vertical && 'col-start-2 row-start-2 pb-3')}>
                {name && (
                  <p className="text-ui text-foreground flex items-center gap-1.5 font-semibold [overflow-wrap:anywhere]">
                    {status && <SeverityGlyph status={status} size={9} />}
                    {name}
                  </p>
                )}
                <p className="text-data-sm text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 font-mono tabular-nums">
                  {segment.asn != null && <span className="text-ink-subtle">AS{segment.asn}</span>}
                  <span>+{formatRouteMs(segment.addedMs)}</span>
                  <span>{hopCount(segment.hops)}</span>
                </p>
                {note && (
                  <p
                    className={cn(
                      'text-label mt-1 flex max-w-[34ch] items-baseline gap-1.5 font-normal',
                      severityText[status!]
                    )}
                  >
                    {!name && <SeverityGlyph status={status!} size={9} />}
                    {note}
                  </p>
                )}
              </div>
            </li>
          )
        })}
        <li
          data-destination={silent ? 'silent' : 'answers'}
          className={cn(
            'flex max-w-[150px] flex-none flex-col gap-1.5 pt-[18px]',
            vertical && 'max-w-none flex-row items-start gap-3 pt-0'
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'bg-foreground size-3.5 flex-none rounded-full',
              vertical && 'mt-0.5',
              silent && 'border-ink-subtle border-[1.5px] border-dashed bg-transparent'
            )}
          />
          <div className="min-w-0">
            <p className="text-ui text-foreground font-semibold [overflow-wrap:anywhere]">
              {destination.name}
            </p>
            {destination.detail && (
              <p className="text-data-sm text-muted-foreground mt-0.5 font-mono [overflow-wrap:anywhere]">
                {destination.detail}
              </p>
            )}
            {silent && (
              <p className="text-label text-ink-subtle mt-0.5 font-normal">{m.hop_silent()}</p>
            )}
          </div>
        </li>
      </ol>
      <div
        data-slot="route-total"
        className={cn(
          'flex min-w-[92px] flex-none flex-col items-end border-l pl-4',
          vertical && 'flex-row items-baseline justify-between gap-3 border-t border-l-0 pt-2 pl-0'
        )}
      >
        <span className="text-readout text-foreground font-mono whitespace-nowrap tabular-nums">
          {silent && `≥${NBSP}`}
          {formatNumber(route.totalMs, Math.abs(route.totalMs) < 10 ? 1 : 0)}
          <small className="text-ui text-muted-foreground">{NBSP}ms</small>
        </span>
        <span
          className={cn(
            'text-ink-subtle mt-0.5 max-w-[15ch] text-right text-[11px] leading-[14px]',
            vertical && 'max-w-none text-left'
          )}
        >
          {silent ? m.route_total_up_to() : m.route_total_rtt()}
        </span>
      </div>
    </div>
  )
}

export { RouteStrip, type RouteStripProps }

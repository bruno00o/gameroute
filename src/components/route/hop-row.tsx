import type { ReactNode } from 'react'

import * as m from '@/paraglide/messages'
import type { DbHop } from '@/types/backend'
import { formatNumber, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import { severityText } from '@/components/status/severity-color'
import { SeverityGlyph } from '@/components/status/severity-glyph'

type HopMode = 'simple' | 'detail'
type HopRail = 'route' | 'hatched' | 'watch' | 'degraded' | 'critical'
type HopNode = 'hop' | 'silent' | 'destination' | 'destination-silent'

const railLine: Record<HopRail, string> = {
  route: 'before:bg-[var(--zone,var(--route-a))]',
  hatched:
    'before:bg-[repeating-linear-gradient(180deg,var(--ink-subtle)_0_3px,transparent_3px_6px)]',
  watch: 'before:bg-watch',
  degraded: 'before:bg-degraded',
  critical: 'before:bg-critical',
}

const nodeRing: Record<HopRail, string> = {
  route: 'shadow-[inset_0_0_0_2px_var(--zone,var(--route-a))]',
  hatched: 'shadow-[inset_0_0_0_2px_var(--route-a)]',
  watch: 'shadow-[inset_0_0_0_2px_var(--watch)]',
  degraded: 'shadow-[inset_0_0_0_2px_var(--degraded)]',
  critical: 'shadow-[inset_0_0_0_2px_var(--critical)]',
}

const nodeShape: Record<HopNode, string> = {
  hop: 'size-2 bg-card',
  silent: 'border-ink-subtle size-2 border-[1.5px] border-dashed bg-card',
  destination: 'bg-foreground size-3 shadow-[0_0_0_2px_var(--card)]',
  'destination-silent':
    'border-ink-subtle size-3 border-[1.5px] border-dashed bg-card shadow-[0_0_0_2px_var(--card)]',
}

const NBSP = ' '
const rowClass ='grid min-h-8 grid-cols-(--hop-cols) items-center gap-x-3'
const numberClass = 'text-ink-subtle text-right font-mono text-xs tabular-nums'
const valueClass = 'text-data text-right font-mono tabular-nums'

function HopRailCell({
  rail,
  node,
  first = false,
  last = false,
  line = true,
}: {
  rail: HopRail
  node?: HopNode
  first?: boolean
  last?: boolean
  line?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      data-rail={line ? rail : undefined}
      className={cn(
        'relative flex justify-center self-stretch',
        line &&
          cn(
            "before:absolute before:top-0 before:bottom-0 before:left-1/2 before:-ml-px before:w-0.5 before:content-['']",
            railLine[rail],
            first && 'before:top-1/2',
            last && 'before:bottom-1/2'
          )
      )}
    >
      {node && (
        <span
          className={cn(
            'relative self-center rounded-full',
            nodeShape[node],
            node === 'hop' && nodeRing[rail]
          )}
        />
      )}
    </span>
  )
}

type HopRowBase = {
  mode: HopMode
  rail: HopRail
  first?: boolean
  last?: boolean
  note?: ReactNode
}

type HopRowProps = HopRowBase &
  (
    | { kind: 'hop'; hop: DbHop; destination?: boolean; name?: string | null }
    | { kind: 'destination-silent'; name: string; ip?: string; atLeastMs: number | null }
  )

function HopRow(props: HopRowProps) {
  const { mode, rail, first, last, note } = props
  const detail = mode === 'detail'

  if (props.kind === 'destination-silent') {
    const { name, ip, atLeastMs } = props
    return (
      <div role="row" data-kind="destination-silent" className={rowClass}>
        <HopRailCell rail={rail} node="destination-silent" first={first} last={last} />
        <span role="cell" className={numberClass}>
          →
        </span>
        <div role="cell" className="flex min-w-0 flex-col py-[5px]">
          <span className="text-ui text-foreground flex items-center gap-1.5 font-semibold [overflow-wrap:anywhere]">
            <SeverityGlyph status="unmeasured" size={9} />
            {name} · {m.hop_silent()}
          </span>
          {detail && ip && ip !== name && (
            <span className="text-data-sm text-ink-subtle font-mono [overflow-wrap:anywhere]">
              {ip}
            </span>
          )}
          {note && (
            <span className="text-label text-muted-foreground mt-0.5 font-normal">{note}</span>
          )}
        </div>
        <span role="cell" />
        <span role="cell" className={cn(valueClass, 'text-muted-foreground whitespace-nowrap')}>
          {atLeastMs != null && `≥${NBSP}${formatNumber(atLeastMs, 1)}`}
        </span>
        {detail && <span role="cell" />}
      </div>
    )
  }

  const { hop, destination = false, name } = props
  const silent = hop.latencyAvg == null
  const lossStatus = silent ? null : hop.lossStatus
  const rateLimited = !silent && !lossStatus && (hop.packetLoss ?? 0) > 0
  const kind = silent
    ? 'silent'
    : destination
      ? 'destination'
      : lossStatus
        ? 'loss'
        : rateLimited
          ? 'rate-limited'
          : 'normal'
  const named = destination && name
  const primary = named ? name : (hop.hostname ?? hop.ip)
  const secondary = detail
    ? [primary !== hop.ip ? hop.ip : null, hop.source && hop.source !== 'ICMP' ? hop.source : null]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div role="row" data-kind={kind} data-loss={lossStatus ?? undefined} className={rowClass}>
      <HopRailCell
        rail={rail}
        node={silent ? 'silent' : destination ? 'destination' : 'hop'}
        first={first}
        last={last}
      />
      <span role="cell" className={numberClass}>
        {destination ? '→' : hop.hopNumber}
      </span>
      <div role="cell" className="flex min-w-0 flex-col py-[5px]">
        {silent ? (
          <span className="text-label text-ink-subtle flex items-center gap-1.5 font-normal">
            <SeverityGlyph status="unmeasured" size={9} />
            {m.hop_silent_router()}
          </span>
        ) : (
          <>
            <span
              className={cn(
                'text-data text-foreground [overflow-wrap:anywhere]',
                named ? 'text-ui font-semibold' : 'font-mono'
              )}
            >
              {primary}
            </span>
            {secondary && (
              <span className="text-data-sm text-ink-subtle font-mono [overflow-wrap:anywhere]">
                {secondary}
              </span>
            )}
            {rateLimited && (
              <span className="text-label text-ink-subtle mt-px flex items-center gap-[5px] font-normal">
                <SeverityGlyph status="unmeasured" size={8} />
                {m.hop_rate_limited()}
              </span>
            )}
            {note && lossStatus && (
              <span className={cn('text-label mt-0.5 font-normal', severityText[lossStatus])}>
                {note}
              </span>
            )}
          </>
        )}
      </div>
      <span
        role="cell"
        title={rateLimited ? m.hop_rate_limited() : undefined}
        className={cn(
          valueClass,
          'text-ink-subtle flex items-center justify-end gap-[5px]',
          lossStatus && cn('font-semibold', severityText[lossStatus])
        )}
      >
        {!silent && lossStatus && <SeverityGlyph status={lossStatus} size={8} />}
        {!silent && (
          <span
            className={cn(
              rateLimited &&
                'decoration-line-strong underline decoration-dashed underline-offset-[3px]'
            )}
          >
            {formatPercent(hop.packetLoss)}
          </span>
        )}
      </span>
      <span role="cell" className={cn(valueClass, 'text-foreground')}>
        {!silent && formatNumber(hop.latencyAvg, 1)}
      </span>
      {detail && (
        <span role="cell" className={cn(valueClass, 'text-muted-foreground')}>
          {!silent && formatNumber(hop.latencyMax, 0)}
        </span>
      )}
    </div>
  )
}

export { HopRow, HopRailCell, type HopRowProps, type HopMode, type HopRail }

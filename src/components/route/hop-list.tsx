import * as m from '@/paraglide/messages'
import type { DbHop, OperatorRoute, RouteSegment } from '@/types/backend'
import { formatRouteMs, lastRespondingHop, segmentAt, segmentName, zoneLabel } from '@/lib/route'
import { cn } from '@/lib/utils'
import { HopRailCell, HopRow, type HopMode, type HopRail } from '@/components/route/hop-row'

type HopListProps = {
  hops: DbHop[]
  targetIp: string
  route?: OperatorRoute | null
  mode?: HopMode
  destinationName?: string | null
  serviceLabel?: string
  pending?: boolean
  className?: string
}

type HopGroup = {
  segment: RouteSegment | undefined
  start: number
  hops: { hop: DbHop; index: number }[]
}

function groupHops(hops: DbHop[], route: OperatorRoute | null | undefined): HopGroup[] {
  const groups: HopGroup[] = []
  hops.forEach((hop, index) => {
    const segment = segmentAt(route, hop.hopNumber)
    const current = groups[groups.length - 1]
    if (current && current.segment === segment) current.hops.push({ hop, index })
    else groups.push({ segment, start: index, hops: [{ hop, index }] })
  })
  return groups
}

function HopList({
  hops,
  targetIp,
  route,
  mode = 'simple',
  destinationName,
  serviceLabel,
  pending = false,
  className,
}: HopListProps) {
  const detail = mode === 'detail'
  const columns = detail ? 5 : 4
  const groups = groupHops(hops, route)

  const onset = hops.findIndex(hop => hop.latencyAvg != null && hop.lossStatus != null)
  const onsetStatus = onset >= 0 ? hops[onset].lossStatus : null
  const trail: HopRail | null =
    onsetStatus === 'watch' || onsetStatus === 'degraded' || onsetStatus === 'critical'
      ? onsetStatus
      : null
  const railAt = (hop: DbHop, index: number): HopRail =>
    hop.latencyAvg == null ? 'hatched' : trail && index >= onset ? trail : 'route'

  const isDestination = (hop: DbHop) => hop.ip === targetIp && hop.latencyAvg != null
  const reached = hops.some(isDestination)
  const waiting = pending && !reached
  const silentDestination = !pending && (route ? route.destinationSilent : !reached)
  const closed = !silentDestination && !waiting
  const lastAnswer = lastRespondingHop(hops)
  const lastSegment = lastAnswer && segmentAt(route, lastAnswer.hopNumber)

  const silentDestinationRow = silentDestination && (
    <HopRow
      kind="destination-silent"
      mode={mode}
      rail="hatched"
      first={hops.length === 0}
      last
      name={destinationName ?? targetIp}
      ip={targetIp}
      atLeastMs={route?.totalMs ?? lastAnswer?.latencyAvg ?? null}
      note={
        lastAnswer &&
        lastSegment &&
        m.hop_measured_up_to({
          hop: String(lastAnswer.hopNumber),
          operator: segmentName(lastSegment) ?? zoneLabel(lastSegment.zone, serviceLabel),
        })
      }
    />
  )

  const pendingRow = waiting && (
    <div
      role="row"
      data-kind="pending"
      aria-live="polite"
      className="grid min-h-8 grid-cols-(--hop-cols) items-center gap-x-3"
    >
      <HopRailCell rail="hatched" node="silent" first={hops.length === 0} last />
      <span role="cell" className="text-ink-subtle text-right font-mono text-xs tabular-nums">
        {(hops.at(-1)?.hopNumber ?? 0) + 1}
      </span>
      <span role="cell" className="text-label text-ink-subtle col-[3/-1] font-normal">
        {m.hop_pending()}
      </span>
    </div>
  )

  return (
    <div
      role="table"
      aria-label={m.hop_list_label()}
      data-slot="hop-list"
      data-mode={mode}
      className={cn(
        'min-w-0',
        detail
          ? '[--hop-cols:18px_26px_minmax(0,1fr)_56px_64px_64px]'
          : '[--hop-cols:18px_26px_minmax(0,1fr)_64px_72px]',
        className
      )}
    >
      <div role="rowgroup">
        <div
          role="row"
          className="text-label text-muted-foreground grid h-[30px] grid-cols-(--hop-cols) items-center gap-x-3 border-b font-stretch-[92%]"
        >
          <span aria-hidden="true" />
          <span role="columnheader" className="text-right">
            #
          </span>
          <span role="columnheader">{detail ? m.hop_col_router() : m.hop_col_step()}</span>
          <span role="columnheader" className="text-right">
            {m.hop_col_loss()}
          </span>
          <span role="columnheader" className="text-right">
            {detail ? m.hop_col_avg() : m.hop_col_ping()}
          </span>
          {detail && (
            <span role="columnheader" className="text-right">
              {m.hop_col_worst()}
            </span>
          )}
        </div>
      </div>

      {groups.map((group, g) => {
        const { segment } = group
        const zone = segment && zoneLabel(segment.zone, serviceLabel)
        const name = segment && segmentName(segment)
        const isLast = g === groups.length - 1

        return (
          <div
            key={group.start}
            role="rowgroup"
            data-zone={segment?.zone}
            aria-label={zone ? [zone, name].filter(Boolean).join(', ') : undefined}
          >
            {segment && (
              <div role="row" className="grid grid-cols-(--hop-cols) gap-x-3">
                <HopRailCell rail={trail && onset < group.start ? trail : 'route'} line={g > 0} />
                <div
                  role="rowheader"
                  aria-colspan={columns}
                  className="col-[3/-1] flex flex-wrap items-baseline gap-x-2 pt-3 pb-1"
                >
                  <span className="text-overline text-ink-subtle font-stretch-[88%] uppercase">
                    <span
                      aria-hidden="true"
                      className="mr-1.5 inline-block size-2 rounded-full bg-(--zone)"
                    />
                    {zone}
                  </span>
                  {name && <span className="text-ui text-foreground font-semibold">{name}</span>}
                  {segment.asn != null && (
                    <span className="text-data-sm text-ink-subtle font-mono">AS{segment.asn}</span>
                  )}
                  <span className="text-data-sm text-muted-foreground ml-auto font-mono tabular-nums">
                    +{formatRouteMs(segment.addedMs)}
                  </span>
                </div>
              </div>
            )}
            {group.hops.map(({ hop, index }) => (
              <HopRow
                key={hop.id}
                kind="hop"
                hop={hop}
                mode={mode}
                rail={railAt(hop, index)}
                first={index === 0}
                last={closed && index === hops.length - 1}
                destination={isDestination(hop)}
                name={destinationName}
                note={index === onset ? m.hop_loss_onset() : undefined}
              />
            ))}
            {isLast && silentDestinationRow}
            {isLast && pendingRow}
          </div>
        )
      })}
      {groups.length === 0 && (silentDestinationRow || pendingRow) && (
        <div role="rowgroup">
          {silentDestinationRow}
          {pendingRow}
        </div>
      )}
    </div>
  )
}

export { HopList, type HopListProps }

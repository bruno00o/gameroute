import type { ReportRoute, RouteZone } from '@gameroute/shared'
import { formatAddedMs, formatMs, ZONE_LABELS } from '@/lib/report-text'
import { cn } from '@/lib/utils'
import { m } from '@/paraglide/messages'
import { SEVERITY_BG, SeverityGlyph } from './SeverityGlyph'

const MIN_SHARE_MS = 4

export const ZONE_BG: Record<RouteZone, string> = {
  home: 'bg-zone-home',
  isp: 'bg-zone-isp',
  transit: 'bg-zone-transit',
  service: 'bg-zone-service',
}

function hopRange(first: number, last: number) {
  return first === last ? m.report_route_hop({ hop: first }) : m.report_route_hops({ first, last })
}

export function RouteStrip({ route }: { route: ReportRoute }) {
  const silent = route.destinationSilent

  return (
    <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-stretch">
      <ol
        aria-label={m.report_route_label()}
        className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:gap-0.5"
      >
        {route.segments.map(segment => {
          const status = segment.status && segment.status !== 'ok' ? segment.status : null
          return (
            <li
              key={`${segment.firstHop}-${segment.lastHop}`}
              data-zone={segment.zone}
              data-status={status ?? undefined}
              style={{ flexGrow: Math.max(segment.addedMs, MIN_SHARE_MS) }}
              className="flex min-w-0 flex-col gap-1.5 sm:min-w-[112px] sm:basis-0"
            >
              <span className="text-overline text-subtle-foreground uppercase font-stretch-88%">
                {ZONE_LABELS[segment.zone]()}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'block h-1.5',
                  (status && SEVERITY_BG[status]) || ZONE_BG[segment.zone]
                )}
              />
              {segment.name && (
                <span className="flex items-center gap-1.5 text-ui font-semibold [overflow-wrap:anywhere]">
                  {status && <SeverityGlyph status={status} size={9} />}
                  {segment.name}
                </span>
              )}
              <span className="flex flex-wrap gap-x-2 font-mono text-[12px] leading-4 text-muted-foreground tabular-nums">
                {segment.asn != null && (
                  <span className="text-subtle-foreground">AS{segment.asn}</span>
                )}
                <span>{formatAddedMs(segment.addedMs)}</span>
                <span>{hopRange(segment.firstHop, segment.lastHop)}</span>
              </span>
            </li>
          )
        })}
        <li
          data-destination={silent ? 'silent' : 'answers'}
          className="flex min-w-0 flex-none flex-row items-start gap-3 sm:max-w-[180px] sm:flex-col sm:gap-1.5 sm:pt-[18px] sm:pl-2"
        >
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 size-3.5 flex-none rounded-full bg-foreground sm:mt-0',
              silent && 'border-[1.5px] border-dashed border-subtle-foreground bg-transparent'
            )}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-ui font-semibold [overflow-wrap:anywhere]">
              {route.destinationName ?? ZONE_LABELS.service()}
            </span>
            <span className="flex flex-wrap gap-x-2 font-mono text-[12px] leading-4 text-muted-foreground">
              {route.destinationAsn != null && (
                <span className="text-subtle-foreground">AS{route.destinationAsn}</span>
              )}
              <span className="[overflow-wrap:anywhere]">{route.targetIp}</span>
            </span>
            {silent && (
              <span className="text-label font-normal text-subtle-foreground">
                {m.report_destination_silent()}
              </span>
            )}
          </span>
        </li>
      </ol>
      <div className="flex flex-none flex-row items-baseline justify-between gap-3 border-t pt-2 md:min-w-[120px] md:flex-col md:items-end md:justify-start md:border-t-0 md:border-l md:pt-0 md:pl-4">
        <span className="font-mono text-readout whitespace-nowrap tabular-nums">
          {formatMs(route.totalMs, silent)}
        </span>
        <span className="text-[11px] leading-[14px] text-subtle-foreground md:max-w-[18ch] md:text-right">
          {silent
            ? m.report_route_total_up_to({ hop: route.lastRespondingHop })
            : m.report_route_total_server()}
        </span>
      </div>
    </div>
  )
}

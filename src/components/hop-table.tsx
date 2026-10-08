import { useMemo } from 'react'

import * as m from '@/paraglide/messages'
import type { DbHop, ResolvedIpData } from '@/types/backend'
import { formatMs, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Map, MapMarker, MarkerContent, MarkerTooltip, MapRoute, MapControls } from '@/components/ui/map'
import { ExpandableMap } from '@/components/expandable-map'
import { SeverityGlyph } from '@/components/status/severity-glyph'
import { severityText } from '@/components/status/severity-color'
import { SilentHop } from '@/components/status/silent-hop'

export function HopTable({
  hops,
  asnData,
  targetIp,
  advancedMode = true,
}: {
  hops: DbHop[]
  asnData?: Map<string, ResolvedIpData>
  targetIp?: string
  advancedMode?: boolean
}) {
  // Check if destination is already in the hop list
  const destinationReached = targetIp
    ? hops.some(h => h.ip === targetIp)
    : true

  // Find last responding hop number for gap display
  const lastRespondingHop = hops.reduce(
    (max, h) => (h.ip ? Math.max(max, h.hopNumber) : max),
    0,
  )

  // Build route coordinates from resolved hop IPs, grouping overlapping locations
  const { routePoints, routeCoords } = useMemo(() => {
    if (!asnData || asnData.size === 0) return { routePoints: null, routeCoords: null }
    const points: MapPoint[] = []
    const coords: [number, number][] = []

    for (const hop of hops) {
      if (!hop.ip) continue
      const resolved = asnData.get(hop.ip)
      if (resolved?.geo.lat == null || resolved?.geo.lon == null) continue

      const lon = resolved.geo.lon!
      const lat = resolved.geo.lat!
      const hopInfo: HopPoint = {
        ip: hop.ip,
        hopNumber: hop.hopNumber,
        latency: hop.latencyAvg,
        isp: resolved.asnInfo.isp,
      }

      // Check if a point already exists at this location (within ~0.01 degree)
      const existing = points.find(
        p => Math.abs(p.lon - lon) < 0.01 && Math.abs(p.lat - lat) < 0.01,
      )
      if (existing) {
        existing.hops.push(hopInfo)
      } else {
        points.push({ lon, lat, hops: [hopInfo] })
        coords.push([lon, lat])
      }
    }

    if (points.length < 2) return { routePoints: null, routeCoords: null }
    return { routePoints: points, routeCoords: coords }
  }, [hops, asnData])

  return (
    <>
    {routePoints && routeCoords && (
      <div className="mb-4 overflow-hidden rounded-lg border">
        <ExpandableMap
          className="h-52"
          renderExpanded={() => (
            <RouteMapContent points={routePoints} coords={routeCoords} />
          )}
        >
          <RouteMapContent points={routePoints} coords={routeCoords} />
        </ExpandableMap>
      </div>
    )}
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">{m.session_hop_number()}</TableHead>
          <TableHead>{m.session_hop_ip()}</TableHead>
          {advancedMode && (
            <TableHead className="hidden sm:table-cell">{m.session_hop_hostname()}</TableHead>
          )}
          <TableHead className="text-right">{advancedMode ? m.session_hop_latency() : m.simple_latency()}</TableHead>
          <TableHead className="text-right">{m.session_hop_loss()}</TableHead>
          {advancedMode && (
            <TableHead className="hidden text-right md:table-cell">{m.session_hop_source()}</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {hops.map(hop => {
          const isDestination = hop.ip === targetIp
          const resolved = hop.ip ? asnData?.get(hop.ip) : undefined
          const asnLabel = resolved
            ? [resolved.asnInfo.isp, resolved.geo.city, resolved.geo.country]
                .filter(Boolean)
                .join(', ')
            : null

          return (
            <TableRow key={hop.id}>
              <TableCell className="tabular-nums">{isDestination ? '→' : hop.hopNumber}</TableCell>
              <TableCell className="font-mono">
                {hop.ip ? (
                  asnLabel ? (
                    <Tooltip>
                      <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
                        {hop.ip}
                      </TooltipTrigger>
                      <TooltipContent>{asnLabel}</TooltipContent>
                    </Tooltip>
                  ) : (
                    hop.ip
                  )
                ) : (
                  <span className="text-muted-foreground">*</span>
                )}
              </TableCell>
              {advancedMode && (
                <TableCell className="hidden max-w-48 truncate sm:table-cell">
                  {hop.hostname ?? <span className="text-muted-foreground">-</span>}
                </TableCell>
              )}
              <TableCell className="text-right font-mono tabular-nums">
                {hop.latencyAvg != null ? (
                  <Tooltip>
                    <TooltipTrigger className="cursor-default">
                      {formatMs(hop.latencyAvg)}
                    </TooltipTrigger>
                    <TooltipContent>
                      {m.session_hop_latency_tooltip({
                        min: formatMs(hop.latencyMin),
                        avg: formatMs(hop.latencyAvg),
                        max: formatMs(hop.latencyMax),
                      })}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <SilentHop />
                )}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                <HopLoss hop={hop} />
              </TableCell>
              {advancedMode && (
                <TableCell className="hidden text-right md:table-cell">
                  {hop.source ? (
                    <Badge variant="outline" className="text-xs font-normal">
                      {hop.source}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">{m.session_hop_default_source()}</span>
                  )}
                </TableCell>
              )}
            </TableRow>
          )
        })}
        {!destinationReached && targetIp && (
          <>
            {lastRespondingHop > 0 && (
              <TableRow>
                <TableCell className="text-muted-foreground tabular-nums">…</TableCell>
                <TableCell colSpan={advancedMode ? 5 : 3}>
                  <span className="text-muted-foreground text-xs italic">
                    {m.session_hop_unknown_hops()}
                  </span>
                </TableCell>
              </TableRow>
            )}
            <TableRow className="bg-muted/30">
              <TableCell className="tabular-nums font-medium">→</TableCell>
              <TableCell className="font-mono">
                {(() => {
                  const destResolved = asnData?.get(targetIp)
                  const destLabel = destResolved
                    ? [destResolved.asnInfo.isp, destResolved.geo.city, destResolved.geo.country]
                        .filter(Boolean)
                        .join(', ')
                    : null
                  return destLabel ? (
                    <Tooltip>
                      <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
                        {targetIp}
                      </TooltipTrigger>
                      <TooltipContent>{destLabel}</TooltipContent>
                    </Tooltip>
                  ) : (
                    targetIp
                  )
                })()}
              </TableCell>
              {advancedMode && (
                <TableCell className="hidden sm:table-cell">
                  <span className="text-muted-foreground">-</span>
                </TableCell>
              )}
              <TableCell className="text-right">
                <span className="text-muted-foreground text-xs">
                  {advancedMode ? m.session_hop_unreachable() : m.simple_icmp_blocked()}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-muted-foreground">-</span>
              </TableCell>
              {advancedMode && (
                <TableCell className="hidden text-right md:table-cell">
                  <span className="text-muted-foreground">-</span>
                </TableCell>
              )}
            </TableRow>
          </>
        )}
      </TableBody>
    </Table>
    </>
  )
}

function HopLoss({ hop }: { hop: DbHop }) {
  if (hop.latencyAvg == null) return null
  if (hop.lossStatus) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 font-medium', severityText[hop.lossStatus])}
      >
        <SeverityGlyph status={hop.lossStatus} size={8} />
        {formatPercent(hop.packetLoss)}
      </span>
    )
  }
  if ((hop.packetLoss ?? 0) > 0) {
    return (
      <Tooltip>
        <TooltipTrigger className="text-ink-subtle decoration-line-strong cursor-default underline decoration-dashed underline-offset-[3px]">
          {formatPercent(hop.packetLoss)}
        </TooltipTrigger>
        <TooltipContent>{m.hop_rate_limited()}</TooltipContent>
      </Tooltip>
    )
  }
  return formatPercent(hop.packetLoss)
}

type HopPoint = { ip: string; hopNumber: number; latency: number | null; isp: string | null }
type MapPoint = { lon: number; lat: number; hops: HopPoint[] }

function RouteMapContent({ points, coords }: { points: MapPoint[]; coords: [number, number][] }) {
  return (
    <Map
      center={[
        points.reduce((s, p) => s + p.lon, 0) / points.length,
        points.reduce((s, p) => s + p.lat, 0) / points.length,
      ]}
      zoom={2}
    >
      <MapControls />
      <MapRoute
        coordinates={coords}
        width={3}
        opacity={0.7}
        interactive={false}
      />
      {points.map((point, i) => {
        const isFirst = i === 0
        const isLast = i === points.length - 1
        const hopNums = point.hops.map(h => h.hopNumber)
        const label =
          hopNums.length === 1
            ? String(hopNums[0])
            : `${hopNums[0]}-${hopNums[hopNums.length - 1]}`
        return (
          <MapMarker key={`group-${i}`} longitude={point.lon} latitude={point.lat}>
            <MarkerContent>
              <div
                className={cn(
                  'bg-foreground text-background flex items-center justify-center rounded-full shadow-md',
                  isFirst || isLast ? 'size-5 text-[9px] font-bold' : 'size-4 text-[8px] font-semibold',
                )}
              >
                {label}
              </div>
            </MarkerContent>
            <MarkerTooltip>
              <div className="space-y-1">
                {point.hops.map(h => (
                  <div key={h.hopNumber} className="flex items-center gap-2">
                    <span className="font-semibold">#{h.hopNumber}</span>
                    <span className="font-mono">{h.ip}</span>
                    {h.latency != null && (
                      <span className="font-mono tabular-nums">{formatMs(h.latency)}</span>
                    )}
                  </div>
                ))}
                {point.hops[0].isp && (
                  <div className="text-muted-foreground opacity-70">{point.hops[0].isp}</div>
                )}
              </div>
            </MarkerTooltip>
          </MapMarker>
        )
      })}
    </Map>
  )
}

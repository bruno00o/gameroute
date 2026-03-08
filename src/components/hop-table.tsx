import { useMemo } from 'react'
import { RiAlertLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { DbHop, ResolvedIpData } from '@/types/backend'
import { latencyColor, formatMs, formatLoss } from '@/lib/format'
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

export function HopTable({
  hops,
  asnData,
  problemHopIndex,
  targetIp,
}: {
  hops: DbHop[]
  asnData?: Map<string, ResolvedIpData>
  problemHopIndex?: number | null
  targetIp?: string
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
        isProblem: hop.isProblemHop,
        latency: hop.latencyAvg,
        isp: resolved.asnInfo.isp,
      }

      // Check if a point already exists at this location (within ~0.01 degree)
      const existing = points.find(
        p => Math.abs(p.lon - lon) < 0.01 && Math.abs(p.lat - lat) < 0.01,
      )
      if (existing) {
        existing.hops.push(hopInfo)
        if (hop.isProblemHop) existing.hasProblem = true
      } else {
        points.push({ lon, lat, hops: [hopInfo], hasProblem: hop.isProblemHop })
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
          <TableHead className="hidden sm:table-cell">{m.session_hop_hostname()}</TableHead>
          <TableHead className="text-right">{m.session_hop_latency()}</TableHead>
          <TableHead className="text-right">{m.session_hop_loss()}</TableHead>
          <TableHead className="hidden text-right md:table-cell">Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hops.map(hop => {
          const isProblem = hop.isProblemHop || hop.hopNumber === problemHopIndex
          const isDestination = hop.ip === targetIp
          const resolved = hop.ip ? asnData?.get(hop.ip) : undefined
          const asnLabel = resolved
            ? [resolved.asnInfo.isp, resolved.geo.city, resolved.geo.country]
                .filter(Boolean)
                .join(', ')
            : null

          return (
            <TableRow key={hop.id} className={cn(isProblem && 'bg-destructive/5')}>
              <TableCell className="tabular-nums">
                <span className="flex items-center gap-1">
                  {isDestination ? '→' : hop.hopNumber}
                  {isProblem && <RiAlertLine className="text-destructive size-3" />}
                </span>
              </TableCell>
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
              <TableCell className="hidden max-w-48 truncate sm:table-cell">
                {hop.hostname ?? <span className="text-muted-foreground">-</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {hop.latencyAvg != null ? (
                  <Tooltip>
                    <TooltipTrigger className={cn('cursor-default', latencyColor(hop.latencyAvg))}>
                      {formatMs(hop.latencyAvg)}ms
                    </TooltipTrigger>
                    <TooltipContent>
                      min {formatMs(hop.latencyMin)} / avg {formatMs(hop.latencyAvg)} / max{' '}
                      {formatMs(hop.latencyMax)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground">{m.session_hop_timeout()}</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {hop.packetLoss != null ? (
                  <span
                    className={cn(
                      hop.packetLoss > 5 && 'text-destructive',
                      hop.packetLoss > 0 && hop.packetLoss <= 5 && 'text-amber-500',
                    )}
                  >
                    {formatLoss(hop.packetLoss)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                {hop.source ? (
                  <Badge variant="outline" className="text-xs font-normal">
                    {hop.source}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">ICMP</span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
        {!destinationReached && targetIp && (
          <>
            {lastRespondingHop > 0 && (
              <TableRow>
                <TableCell className="text-muted-foreground tabular-nums">…</TableCell>
                <TableCell colSpan={5}>
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
              <TableCell className="hidden sm:table-cell">
                <span className="text-muted-foreground">-</span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-muted-foreground text-xs">
                  {m.session_hop_unreachable()}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-muted-foreground">-</span>
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <span className="text-muted-foreground">-</span>
              </TableCell>
            </TableRow>
          </>
        )}
      </TableBody>
    </Table>
    </>
  )
}

type HopPoint = { ip: string; hopNumber: number; isProblem: boolean; latency: number | null; isp: string | null }
type MapPoint = { lon: number; lat: number; hops: HopPoint[]; hasProblem: boolean }

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
        color="#3b82f6"
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
                  'flex items-center justify-center rounded-full text-white shadow-md',
                  isFirst || isLast ? 'size-5 text-[9px] font-bold' : 'size-4 text-[8px] font-semibold',
                  isFirst
                    ? 'bg-emerald-500'
                    : isLast
                      ? 'bg-red-500'
                      : point.hasProblem
                        ? 'bg-red-500'
                        : 'bg-blue-500',
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
                      <span className={latencyColor(h.latency)}>
                        {formatMs(h.latency)}ms
                      </span>
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

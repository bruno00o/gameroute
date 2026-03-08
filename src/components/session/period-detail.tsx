import { useMemo } from 'react'
import { RiMapPinLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { IpPeriod, IpPeriodSummary, TracerouteWithHops } from '@/types/backend'
import { formatDate, formatDuration, formatMs, latencyColor, computeDurationSecs } from '@/lib/format'
import { useAsnResolution } from '@/hooks/use-asn-resolution'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Map, MapMarker, MarkerContent, MarkerTooltip, MapControls } from '@/components/ui/map'
import { ExpandableMap } from '@/components/expandable-map'
import { HopTable } from '@/components/hop-table'

export function PeriodDetail({
  period,
  summary,
  traceroute,
}: {
  period: IpPeriod
  summary: IpPeriodSummary | undefined
  traceroute: TracerouteWithHops | undefined
}) {
  const durationSecs = computeDurationSecs(period.startedAt, period.endedAt)

  // Collect all IPs for ASN resolution: period IP + hop IPs
  const allIps = useMemo(() => {
    const ips = new Set<string>([period.ip])
    if (traceroute) {
      for (const hop of traceroute.hops) {
        if (hop.ip) ips.add(hop.ip)
      }
    }
    return Array.from(ips)
  }, [period.ip, traceroute])

  const { data: asnData } = useAsnResolution(allIps)
  const resolved = asnData.get(period.ip)
  const asnLabel = resolved
    ? [resolved.asnInfo.isp, resolved.asnInfo.org, resolved.geo.city, resolved.geo.country]
        .filter(Boolean)
        .join(', ')
    : null

  const routeStats = useMemo(() => {
    if (!traceroute) return null

    const hopCount = traceroute.hops.length
    const problemHops = traceroute.hops.filter(h => h.isProblemHop).length

    // Latency = last responding hop's avg latency
    let serverLatency: number | null = null
    for (let i = traceroute.hops.length - 1; i >= 0; i--) {
      if (traceroute.hops[i].latencyAvg != null) {
        serverLatency = traceroute.hops[i].latencyAvg
        break
      }
    }

    return { hopCount, problemHops, serverLatency }
  }, [traceroute])

  const packetRate = summary && summary.totalDurationSecs > 0
    ? summary.totalPacketCount / summary.totalDurationSecs
    : null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-mono text-lg font-medium">{period.ip}</h2>
        {asnLabel && <p className="text-muted-foreground mt-0.5 text-xs">{asnLabel}</p>}
      </div>

      {resolved?.geo.lat != null && resolved?.geo.lon != null && (
        <div className="overflow-hidden rounded-lg border">
          <ExpandableMap
            className="h-40"
            renderExpanded={() => (
              <PeriodMapContent
                lon={resolved.geo.lon!}
                lat={resolved.geo.lat!}
                ip={period.ip}
                isGameServer={period.isGameServer}
                isp={resolved.asnInfo.isp}
                location={[resolved.geo.city, resolved.geo.country].filter(Boolean).join(', ')}
              />
            )}
          >
            <PeriodMapContent
              lon={resolved.geo.lon!}
              lat={resolved.geo.lat!}
              ip={period.ip}
              isGameServer={period.isGameServer}
              isp={resolved.asnInfo.isp}
              location={[resolved.geo.city, resolved.geo.country].filter(Boolean).join(', ')}
            />
          </ExpandableMap>
          <div className="bg-muted/30 flex items-center gap-2 px-3 py-1.5">
            <RiMapPinLine className="text-muted-foreground size-3.5" />
            <span className="text-muted-foreground text-xs">
              {[resolved.geo.city, resolved.geo.country].filter(Boolean).join(', ')}
            </span>
          </div>
        </div>
      )}

      <Separator />

      {routeStats && (
        <section>
          <h3 className="mb-3 text-sm font-medium">{m.session_ip_route_info()}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_hop_count()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium">{routeStats.hopCount}</p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_latency()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-sm font-medium ${latencyColor(routeStats.serverLatency)}`}>
                  {routeStats.serverLatency != null ? `${formatMs(routeStats.serverLatency)} ms` : '-'}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_problem_hops()}</CardTitle>
              </CardHeader>
              <CardContent>
                {routeStats.problemHops > 0 ? (
                  <Badge variant="destructive">{routeStats.problemHops}</Badge>
                ) : (
                  <p className="text-emerald-500 text-sm font-medium">{m.session_no_problems()}</p>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_packet_rate()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium tabular-nums">
                  {packetRate != null ? `${packetRate.toFixed(1)}/s` : '-'}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-medium">{m.session_period()}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{m.session_period_protocol()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium">{period.protocol || '-'}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{m.session_period_port()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium tabular-nums">{period.port || '-'}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{m.session_period_start()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs">{formatDate(period.startedAt)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{m.session_period_end()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs">{formatDate(period.endedAt)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{m.session_period_duration()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium">{formatDuration(durationSecs)}</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{m.session_period_packets()}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium tabular-nums">{period.packetCount}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {summary && (
        <section>
          <h3 className="mb-3 text-sm font-medium">{m.session_ip_summary()}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_total_duration()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium">
                  {formatDuration(Math.round(summary.totalDurationSecs))}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_total_packets()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium tabular-nums">{summary.totalPacketCount}</p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_first_seen()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs">{formatDate(summary.firstSeenAt)}</p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{m.session_ip_last_seen()}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs">{formatDate(summary.lastSeenAt)}</p>
              </CardContent>
            </Card>
          </div>
          {summary.periodCount > 1 && (
            <p className="text-muted-foreground mt-2 text-xs">
              {m.session_ip_periods({ count: String(summary.periodCount) })}
            </p>
          )}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-medium">{m.session_traceroute()}</h3>
          {traceroute?.tracerouteMethod && (
            <Badge variant="outline" className="text-xs font-normal">
              {traceroute.tracerouteMethod}
            </Badge>
          )}
        </div>
        {traceroute ? (
          <HopTable
            hops={traceroute.hops}
            asnData={asnData}
            problemHopIndex={traceroute.problemHopIndex}
            targetIp={traceroute.targetIp}
          />
        ) : (
          <p className="text-muted-foreground text-xs">{m.session_no_traceroute()}</p>
        )}
      </section>
    </div>
  )
}

function PeriodMapContent({
  lon,
  lat,
  ip,
  isGameServer,
  isp,
  location,
}: {
  lon: number
  lat: number
  ip: string
  isGameServer: boolean
  isp: string | null
  location: string
}) {
  return (
    <Map center={[lon, lat]} zoom={4}>
      <MapControls />
      <MapMarker longitude={lon} latitude={lat}>
        <MarkerContent>
          <div
            className={cn(
              'size-4 rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.1)]',
              isGameServer ? 'bg-amber-500' : 'bg-red-500',
            )}
          />
        </MarkerContent>
        <MarkerTooltip>
          <div className="space-y-0.5">
            <div className="font-mono font-medium">{ip}</div>
            {isp && <div className="opacity-70">{isp}</div>}
            {location && <div className="opacity-70">{location}</div>}
          </div>
        </MarkerTooltip>
      </MapMarker>
    </Map>
  )
}

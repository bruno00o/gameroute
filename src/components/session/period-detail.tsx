import { useMemo } from 'react'
import { RiMapPinLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { IpPeriod, IpPeriodSummary, TracerouteWithHops } from '@/types/backend'
import {
  formatDate,
  formatDuration,
  formatMs,
  formatNumber,
  computeDurationSecs,
} from '@/lib/format'
import { useAsnResolution } from '@/hooks/use-asn-resolution'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'
import { Map, MapMarker, MarkerContent, MarkerTooltip, MapControls } from '@/components/ui/map'
import { EmptyState } from '@/components/empty-state'
import { ExpandableMap } from '@/components/expandable-map'
import { Fact, FactRow } from '@/components/fact-row'
import { HopTable } from '@/components/hop-table'
import { Panel } from '@/components/panel'
import { StatusPill } from '@/components/status/status-pill'

export function PeriodDetail({
  period,
  summary,
  traceroute,
}: {
  period: IpPeriod
  summary: IpPeriodSummary | undefined
  traceroute: TracerouteWithHops | undefined
}) {
  const advancedMode = useSettingsStore(s => s.advancedMode)
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

    const destinationSilent = !traceroute.hops.some(
      h => h.ip === traceroute.targetIp && h.latencyAvg != null
    )

    return { hopCount, problemHops, serverLatency, destinationSilent, status: traceroute.status }
  }, [traceroute])

  const packetRate =
    summary && summary.totalDurationSecs > 0
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

      {routeStats && (
        <Panel level={3} label={m.session_ip_route_info()}>
          <FactRow>
            <Fact label={m.session_ip_hop_count()}>{routeStats.hopCount}</Fact>
            <Fact label={m.session_ip_latency()}>
              {formatMs(routeStats.serverLatency, { atLeast: routeStats.destinationSilent })}
              <StatusPill status={routeStats.status} size="sm" className="font-sans" />
            </Fact>
            <Fact label={m.session_ip_problem_hops()}>
              {routeStats.problemHops > 0 ? (
                routeStats.problemHops
              ) : (
                <span className="text-ui font-sans">{m.session_no_problems()}</span>
              )}
            </Fact>
            <Fact label={m.session_ip_packet_rate()}>
              {packetRate != null && `${formatNumber(packetRate, 1)}/s`}
            </Fact>
          </FactRow>
        </Panel>
      )}

      <Panel level={3} label={m.session_period()}>
        <FactRow>
          {advancedMode && <Fact label={m.session_period_protocol()}>{period.protocol}</Fact>}
          {advancedMode && <Fact label={m.session_period_port()}>{period.port || null}</Fact>}
          <Fact label={m.session_period_start()}>{formatDate(period.startedAt)}</Fact>
          <Fact label={m.session_period_end()}>{formatDate(period.endedAt)}</Fact>
          <Fact label={m.session_period_duration()}>{formatDuration(durationSecs)}</Fact>
          {advancedMode && (
            <Fact label={m.session_period_packets()}>{formatNumber(period.packetCount)}</Fact>
          )}
        </FactRow>
      </Panel>

      {summary && (
        <Panel
          level={3}
          label={m.session_ip_summary()}
          title={
            summary.periodCount > 1
              ? m.session_ip_periods({ count: String(summary.periodCount) })
              : undefined
          }
        >
          <FactRow>
            <Fact label={m.session_ip_total_duration()}>
              {formatDuration(Math.round(summary.totalDurationSecs))}
            </Fact>
            {advancedMode && (
              <Fact label={m.session_ip_total_packets()}>
                {formatNumber(summary.totalPacketCount)}
              </Fact>
            )}
            <Fact label={m.session_ip_first_seen()}>{formatDate(summary.firstSeenAt)}</Fact>
            <Fact label={m.session_ip_last_seen()}>{formatDate(summary.lastSeenAt)}</Fact>
          </FactRow>
        </Panel>
      )}

      <Panel
        level={3}
        label={m.session_traceroute()}
        title={advancedMode ? traceroute?.tracerouteMethod : undefined}
        flush={traceroute != null}
      >
        {traceroute ? (
          <HopTable
            hops={traceroute.hops}
            asnData={asnData}
            targetIp={traceroute.targetIp}
            advancedMode={advancedMode}
          />
        ) : (
          <EmptyState compact title={m.session_no_traceroute()} />
        )}
      </Panel>
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
              isGameServer ? 'bg-foreground' : 'bg-route-b',
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

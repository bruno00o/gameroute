import { useMemo, useState } from 'react'

import * as m from '@/paraglide/messages'
import type { IpPeriod, IpPeriodSummary, TracerouteWithHops } from '@/types/backend'
import {
  formatDate,
  formatDuration,
  formatMs,
  formatNumber,
  computeDurationSecs,
} from '@/lib/format'
import { shortOperatorName } from '@/lib/operators'
import { lastRespondingHop, routeMapPoints } from '@/lib/route'
import { useAsnResolution } from '@/hooks/use-asn-resolution'
import { useSettingsStore } from '@/stores/settings-store'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { Fact, FactRow } from '@/components/fact-row'
import { Panel } from '@/components/panel'
import { HopList } from '@/components/route/hop-list'
import { RouteMap } from '@/components/route/route-map'
import { RouteStrip } from '@/components/route/route-strip'
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
  const [showMap, setShowMap] = useState(false)
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
    const lastAnswer = lastRespondingHop(traceroute.hops)

    const destinationSilent = !traceroute.hops.some(
      h => h.ip === traceroute.targetIp && h.latencyAvg != null
    )

    return {
      hopCount,
      problemHops,
      serverLatency: lastAnswer?.latencyAvg ?? null,
      lastLoss: lastAnswer?.packetLoss ?? null,
      destinationSilent,
      status: traceroute.status,
    }
  }, [traceroute])

  const mapPoints = useMemo(
    () => (traceroute ? routeMapPoints(traceroute.hops, traceroute.targetIp, asnData) : []),
    [traceroute, asnData]
  )

  const destinationName = shortOperatorName(traceroute?.route?.destinationName)
  const serviceLabel =
    period.flowKind === 'voice'
      ? m.route_zone_service_voice()
      : period.isGameServer || period.flowKind === 'game'
        ? undefined
        : m.route_zone_service_other()

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

      {traceroute && routeStats && (
        <Panel
          level={3}
          label={m.session_ip_route_info()}
          action={
            mapPoints.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={showMap}
                onClick={() => setShowMap(open => !open)}
              >
                {showMap ? m.route_hide_map() : m.route_show_map()}
              </Button>
            )
          }
        >
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
          {traceroute.route && (
            <RouteStrip
              className="mt-4 border-t pt-4"
              route={traceroute.route}
              destination={{
                name: destinationName ?? m.route_destination(),
                detail: traceroute.targetIp,
              }}
              persistentLoss={routeStats.lastLoss}
              serviceLabel={serviceLabel}
            />
          )}
          {showMap && mapPoints.length > 0 && <RouteMap className="mt-4" points={mapPoints} />}
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
        label={m.hop_list_label()}
        title={advancedMode ? traceroute?.tracerouteMethod : undefined}
      >
        {traceroute ? (
          <HopList
            hops={traceroute.hops}
            targetIp={traceroute.targetIp}
            route={traceroute.route}
            mode={advancedMode ? 'detail' : 'simple'}
            destinationName={destinationName}
            serviceLabel={serviceLabel}
          />
        ) : (
          <EmptyState compact title={m.session_no_traceroute()} />
        )}
      </Panel>
    </div>
  )
}

import { useMemo } from 'react'

import * as m from '@/paraglide/messages'
import type { IpPeriod, IpPeriodSummary, TracerouteWithHops } from '@/types/backend'
import { formatDate, formatDuration, computeDurationSecs } from '@/lib/format'
import { useAsnResolution } from '@/hooks/use-asn-resolution'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-mono text-lg font-medium">{period.ip}</h2>
        {asnLabel && <p className="text-muted-foreground mt-0.5 text-xs">{asnLabel}</p>}
      </div>

      <Separator />

      <section>
        <h3 className="mb-3 text-sm font-medium">{m.session_period()}</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <h3 className="mb-3 text-sm font-medium">{m.session_traceroute()}</h3>
        {traceroute ? (
          <HopTable
            hops={traceroute.hops}
            asnData={asnData}
            problemHopIndex={traceroute.problemHopIndex}
          />
        ) : (
          <p className="text-muted-foreground text-xs">{m.session_no_traceroute()}</p>
        )}
      </section>
    </div>
  )
}

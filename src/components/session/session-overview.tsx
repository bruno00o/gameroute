import { useMemo } from 'react'
import {
  RiAlertLine,
  RiGlobalLine,
  RiRouteLine,
  RiSpeedLine,
  RiStackLine,
  RiTimeLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { SessionDetail } from '@/types/backend'
import { formatDate, formatDuration, formatMs, latencyColor, computeDurationSecs } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export function SessionOverview({ detail }: { detail: SessionDetail }) {
  const isActive = detail.endedAt === null
  const durationSecs = computeDurationSecs(detail.startedAt, detail.endedAt)

  const stats = useMemo(() => {
    const totalPackets = detail.ipSummaries.reduce((sum, s) => sum + s.totalPacketCount, 0)

    let problemHopCount = 0
    let latencySum = 0
    let latencyCount = 0

    for (const tr of detail.traceroutes) {
      for (const hop of tr.hops) {
        if (hop.isProblemHop) problemHopCount++
        if (hop.latencyAvg != null) {
          latencySum += hop.latencyAvg
          latencyCount++
        }
      }
    }

    const avgLatency = latencyCount > 0 ? latencySum / latencyCount : null

    return { totalPackets, problemHopCount, avgLatency }
  }, [detail])

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">{detail.gameName}</h2>
          <Badge variant={isActive ? 'default' : 'secondary'}>
            {isActive ? m.sessions_status_active() : m.sessions_status_completed()}
          </Badge>
        </div>
      </div>

      <Separator />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiTimeLine className="text-muted-foreground size-3.5" />
              {m.session_duration()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">{formatDuration(durationSecs)}</p>
            <p className="text-muted-foreground text-xs">{formatDate(detail.startedAt)}</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiGlobalLine className="text-muted-foreground size-3.5" />
              {m.session_ips_count()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">{detail.ipSummaries.length}</p>
            <p className="text-muted-foreground text-xs">
              {m.session_ip_periods({ count: String(detail.ipPeriods.length) })}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiRouteLine className="text-muted-foreground size-3.5" />
              {m.session_traceroutes_count()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">{detail.traceroutes.length}</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiStackLine className="text-muted-foreground size-3.5" />
              {m.session_total_packets()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium tabular-nums">
              {stats.totalPackets.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiSpeedLine className="text-muted-foreground size-3.5" />
              {m.session_avg_latency()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-lg font-medium ${latencyColor(stats.avgLatency)}`}>
              {stats.avgLatency != null ? `${formatMs(stats.avgLatency)} ms` : '-'}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiAlertLine className="text-muted-foreground size-3.5" />
              {m.session_problem_hops()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.problemHopCount > 0 ? (
              <p className="text-destructive text-lg font-medium">{stats.problemHopCount}</p>
            ) : (
              <p className="text-emerald-500 text-sm font-medium">{m.session_no_problems()}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

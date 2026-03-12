import { useMemo } from 'react'
import {
  RiAlertLine,
  RiGlobalLine,
  RiLoopLeftLine,
  RiRouteLine,
  RiSpeedLine,
  RiShieldCheckLine,
  RiTimeLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { SessionDetail } from '@/types/backend'
import { formatDate, formatDuration, formatMs, latencyColor, computeDurationSecs } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface SessionOverviewProps {
  detail: SessionDetail
  onRetry?: () => void
  isRetrying?: boolean
}

export function SessionOverview({ detail, onRetry, isRetrying }: SessionOverviewProps) {
  const isActive = detail.endedAt === null
  const durationSecs = computeDurationSecs(detail.startedAt, detail.endedAt)

  const stats = useMemo(() => {
    const gameServerIps = new Set(
      detail.ipSummaries.filter((s) => s.isGameServer).map((s) => s.ip),
    )

    const gsTraceroutes = detail.traceroutes.filter((tr) => gameServerIps.has(tr.targetIp))

    let problemHopCount = 0
    let totalHopCount = 0
    let destLatencySum = 0
    let destLatencyCount = 0

    for (const tr of gsTraceroutes) {
      for (const hop of tr.hops) {
        totalHopCount++
        if (hop.isProblemHop) problemHopCount++
      }

      // Use destination latency (last responding hop) instead of averaging all hops
      for (let i = tr.hops.length - 1; i >= 0; i--) {
        if (tr.hops[i].latencyAvg != null) {
          destLatencySum += tr.hops[i].latencyAvg!
          destLatencyCount++
          break
        }
      }
    }

    const avgLatency = destLatencyCount > 0 ? destLatencySum / destLatencyCount : null
    const stability = totalHopCount > 0 ? Math.round(((totalHopCount - problemHopCount) / totalHopCount) * 100) : null

    return { stability, problemHopCount, avgLatency }
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
            <div className="flex items-center justify-between">
              <p className="text-lg font-medium">{detail.traceroutes.length}</p>
              {!isActive && onRetry && (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={onRetry}
                  disabled={isRetrying}
                >
                  <RiLoopLeftLine data-icon="inline-start" className={isRetrying ? 'animate-spin' : ''} />
                  {m.session_retry_traceroutes()}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <Tooltip>
              <TooltipTrigger render={<CardTitle className="flex items-center gap-2 cursor-help" />}>
                  <RiShieldCheckLine className="text-muted-foreground size-3.5" />
                  <span className="underline decoration-dotted">{m.session_route_stability()}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">{m.session_route_stability_tooltip()}</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            {stats.stability != null ? (
              <p className={`text-lg font-medium ${stats.stability >= 90 ? 'text-emerald-500' : stats.stability >= 70 ? 'text-amber-500' : 'text-destructive'}`}>
                {stats.stability}%
              </p>
            ) : (
              <p className="text-muted-foreground text-lg font-medium">-</p>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <Tooltip>
              <TooltipTrigger render={<CardTitle className="flex items-center gap-2 cursor-help" />}>
                  <RiSpeedLine className="text-muted-foreground size-3.5" />
                  <span className="underline decoration-dotted">{m.session_avg_latency()}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">{m.session_avg_latency_tooltip()}</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <p className={`text-lg font-medium ${latencyColor(stats.avgLatency)}`}>
              {stats.avgLatency != null ? `${formatMs(stats.avgLatency)} ms` : '-'}
            </p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <Tooltip>
              <TooltipTrigger render={<CardTitle className="flex items-center gap-2 cursor-help" />}>
                  <RiAlertLine className="text-muted-foreground size-3.5" />
                  <span className="underline decoration-dotted">{m.session_problem_hops()}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">{m.session_problem_hops_tooltip()}</TooltipContent>
            </Tooltip>
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

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  RiAlertLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiClipboardLine,
  RiDownloadLine,
  RiGlobalLine,
  RiLoopLeftLine,
  RiRouteLine,
  RiSpeedLine,
  RiShieldCheckLine,
  RiTimeLine,
} from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { SessionDetail } from '@/types/backend'
import { formatDate, formatDuration, formatMs, latencyColor, computeDurationSecs } from '@/lib/format'
import { generateSessionExport } from '@/lib/export-llm'
import { exportSessionDetail } from '@/lib/export-csv'
import { getPreviousSessionId, getSessionDetail } from '@/lib/tauri'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings-store'
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

type SessionStats = {
  stability: number | null
  problemHopCount: number
  avgLatency: number | null
}

function computeSessionStats(detail: SessionDetail): SessionStats {
  const gameServerIps = new Set(
    detail.ipSummaries.filter(s => s.isGameServer).map(s => s.ip),
  )
  const gsTraceroutes = detail.traceroutes.filter(tr => gameServerIps.has(tr.targetIp))

  let problemHopCount = 0
  let totalHopCount = 0
  let destLatencySum = 0
  let destLatencyCount = 0

  for (const tr of gsTraceroutes) {
    for (const hop of tr.hops) {
      totalHopCount++
      if (hop.isProblemHop) problemHopCount++
    }
    for (let i = tr.hops.length - 1; i >= 0; i--) {
      if (tr.hops[i].latencyAvg != null) {
        destLatencySum += tr.hops[i].latencyAvg!
        destLatencyCount++
        break
      }
    }
  }

  const avgLatency = destLatencyCount > 0 ? destLatencySum / destLatencyCount : null
  const stability = totalHopCount > 0
    ? Math.round(((totalHopCount - problemHopCount) / totalHopCount) * 100)
    : null

  return { stability, problemHopCount, avgLatency }
}

function DeltaBadge({ current, previous, unit = '', invert = false }: {
  current: number | null
  previous: number | null
  unit?: string
  invert?: boolean
}) {
  if (current == null || previous == null) return null
  const diff = current - previous
  if (diff === 0) return null

  const isPositive = diff > 0
  // For latency/problem hops, positive = bad. For stability, positive = good.
  const isGood = invert ? isPositive : !isPositive
  const formatted = `${isPositive ? '+' : ''}${Number.isInteger(diff) ? diff : diff.toFixed(1)}${unit}`

  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] font-medium',
      isGood ? 'text-ok' : 'text-destructive',
    )}>
      {isPositive
        ? <RiArrowUpSLine className="size-3" />
        : <RiArrowDownSLine className="size-3" />}
      {formatted}
    </span>
  )
}

export function SessionOverview({ detail, onRetry, isRetrying }: SessionOverviewProps) {
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const isActive = detail.endedAt === null
  const durationSecs = computeDurationSecs(detail.startedAt, detail.endedAt)

  const handleExportLlm = useCallback(async () => {
    try {
      const text = generateSessionExport(detail)
      await navigator.clipboard.writeText(text)
      toast.success(m.export_llm_copied())
    } catch {
      toast.error(m.export_llm_error())
    }
  }, [detail])

  const stats = useMemo(() => computeSessionStats(detail), [detail])

  // Fetch previous session for comparison
  const { data: prevSessionId } = useQuery({
    queryKey: ['previous-session-id', detail.gameName, detail.startedAt],
    queryFn: () => getPreviousSessionId(detail.gameName, detail.startedAt),
    enabled: !isActive,
    staleTime: Infinity,
  })

  const { data: prevDetail } = useQuery({
    queryKey: ['session', prevSessionId],
    queryFn: () => getSessionDetail(prevSessionId!),
    enabled: prevSessionId != null,
    staleTime: Infinity,
  })

  const prevStats = useMemo(
    () => (prevDetail ? computeSessionStats(prevDetail) : null),
    [prevDetail],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">{detail.gameName}</h2>
          <Badge variant={isActive ? 'default' : 'secondary'}>
            {isActive ? m.sessions_status_active() : m.sessions_status_completed()}
          </Badge>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => exportSessionDetail(detail)}>
            <RiDownloadLine data-icon="inline-start" />
            {m.export_csv_button()}
          </Button>
          <Tooltip>
            <TooltipTrigger render={
              <Button variant="outline" size="sm" onClick={handleExportLlm} />
            }>
              <RiClipboardLine data-icon="inline-start" />
              {m.export_llm_button()}
            </TooltipTrigger>
            <TooltipContent side="bottom">{m.export_llm_tooltip()}</TooltipContent>
          </Tooltip>
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
              {advancedMode ? m.session_traceroutes_count() : m.simple_traceroutes()}
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
                  <span className="underline decoration-dotted">{advancedMode ? m.session_route_stability() : m.simple_route_stability()}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">{advancedMode ? m.session_route_stability_tooltip() : m.simple_route_stability_tooltip()}</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            {stats.stability != null ? (
              <div className="flex items-baseline gap-2">
                <p className={`text-lg font-medium ${stats.stability >= 90 ? 'text-ok' : stats.stability >= 70 ? 'text-watch' : 'text-destructive'}`}>
                  {stats.stability}%
                </p>
                <DeltaBadge current={stats.stability} previous={prevStats?.stability ?? null} unit="%" invert />
              </div>
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
                  <span className="underline decoration-dotted">{advancedMode ? m.session_avg_latency() : m.simple_avg_latency()}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">{advancedMode ? m.session_avg_latency_tooltip() : m.simple_avg_latency_tooltip()}</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <p className={`text-lg font-medium ${latencyColor(stats.avgLatency)}`}>
                {stats.avgLatency != null ? `${formatMs(stats.avgLatency)} ms` : '-'}
              </p>
              <DeltaBadge current={stats.avgLatency} previous={prevStats?.avgLatency ?? null} unit=" ms" />
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <Tooltip>
              <TooltipTrigger render={<CardTitle className="flex items-center gap-2 cursor-help" />}>
                  <RiAlertLine className="text-muted-foreground size-3.5" />
                  <span className="underline decoration-dotted">{advancedMode ? m.session_problem_hops() : m.simple_problem_hops()}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">{advancedMode ? m.session_problem_hops_tooltip() : m.simple_problem_hops_tooltip()}</TooltipContent>
            </Tooltip>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              {stats.problemHopCount > 0 ? (
                <p className="text-destructive text-lg font-medium">{stats.problemHopCount}</p>
              ) : (
                <p className="text-ok text-sm font-medium">{m.session_no_problems()}</p>
              )}
              <DeltaBadge current={stats.problemHopCount} previous={prevStats?.problemHopCount ?? null} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

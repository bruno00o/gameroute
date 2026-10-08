import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiClipboardLine,
  RiDownloadLine,
  RiLoopLeftLine,
} from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { SessionDetail } from '@/types/backend'
import {
  formatDate,
  formatDuration,
  formatMs,
  formatNumber,
  formatPercent,
  computeDurationSecs,
} from '@/lib/format'
import { generateSessionExport } from '@/lib/export-llm'
import { exportSessionDetail } from '@/lib/export-csv'
import { getPreviousSessionId, getSessionDetail } from '@/lib/tauri'
import { useSettingsStore } from '@/stores/settings-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Fact, FactRow } from '@/components/fact-row'

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

function DeltaBadge({ current, previous, unit }: {
  current: number | null
  previous: number | null
  unit?: 'ms' | '%'
}) {
  if (current == null || previous == null) return null
  const diff = current - previous
  if (diff === 0) return null

  const isPositive = diff > 0
  const digits = Number.isInteger(diff) ? 0 : 1
  const magnitude =
    unit === 'ms'
      ? formatMs(Math.abs(diff), { digits })
      : unit === '%'
        ? formatPercent(Math.abs(diff), { digits })
        : formatNumber(Math.abs(diff), digits)
  const formatted = `${isPositive ? '+' : '−'}${magnitude}`

  return (
    <span className="text-muted-foreground inline-flex items-center gap-0.5 font-mono text-[10px] font-medium tabular-nums">
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
          {!isActive && onRetry && (
            <Button size="sm" onClick={onRetry} loading={isRetrying}>
              <RiLoopLeftLine data-icon="inline-start" />
              {m.session_retry_traceroutes()}
            </Button>
          )}
          <Button size="sm" onClick={() => exportSessionDetail(detail)}>
            <RiDownloadLine data-icon="inline-start" />
            {m.export_csv_button()}
          </Button>
          <Tooltip>
            <TooltipTrigger render={<Button size="sm" onClick={handleExportLlm} />}>
              <RiClipboardLine data-icon="inline-start" />
              {m.export_llm_button()}
            </TooltipTrigger>
            <TooltipContent side="bottom">{m.export_llm_tooltip()}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <Separator />

      <FactRow>
        <Fact label={m.session_duration()} detail={formatDate(detail.startedAt)}>
          {formatDuration(durationSecs)}
        </Fact>
        <Fact
          label={m.session_ips_count()}
          detail={m.session_ip_periods({ count: String(detail.ipPeriods.length) })}
        >
          {detail.ipSummaries.length}
        </Fact>
        <Fact label={advancedMode ? m.session_traceroutes_count() : m.simple_traceroutes()}>
          {detail.traceroutes.length}
        </Fact>
        <Fact
          label={advancedMode ? m.session_route_stability() : m.simple_route_stability()}
          hint={
            advancedMode ? m.session_route_stability_tooltip() : m.simple_route_stability_tooltip()
          }
        >
          {stats.stability != null && (
            <>
              {formatPercent(stats.stability)}
              <DeltaBadge
                current={stats.stability}
                previous={prevStats?.stability ?? null}
                unit="%"
              />
            </>
          )}
        </Fact>
        <Fact
          label={advancedMode ? m.session_avg_latency() : m.simple_avg_latency()}
          hint={advancedMode ? m.session_avg_latency_tooltip() : m.simple_avg_latency_tooltip()}
        >
          {formatMs(stats.avgLatency)}
          <DeltaBadge
            current={stats.avgLatency}
            previous={prevStats?.avgLatency ?? null}
            unit="ms"
          />
        </Fact>
        <Fact
          label={advancedMode ? m.session_problem_hops() : m.simple_problem_hops()}
          hint={advancedMode ? m.session_problem_hops_tooltip() : m.simple_problem_hops_tooltip()}
        >
          {stats.problemHopCount > 0 ? (
            stats.problemHopCount
          ) : (
            <span className="font-sans text-ui">{m.session_no_problems()}</span>
          )}
          <DeltaBadge
            current={stats.problemHopCount}
            previous={prevStats?.problemHopCount ?? null}
          />
        </Fact>
      </FactRow>
    </div>
  )
}

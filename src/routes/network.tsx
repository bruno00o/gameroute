import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Line, LineChart, Bar, BarChart, XAxis, YAxis, CartesianGrid } from 'recharts'

import * as m from '@/paraglide/messages'
import { getNetworkQualityOverTime, getHourlyQuality } from '@/lib/tauri'
import { formatDate } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { SessionHeader } from '@/components/session/session-screen'

export const Route = createFileRoute('/network')({
  component: HistoryPage,
})

function HistoryPage() {
  const qualityChartConfig = useMemo<ChartConfig>(
    () => ({
      avgLatency: {
        label: m.insights_quality_latency(),
        color: 'var(--chart-1)',
      },
      problemHopPercent: {
        label: m.insights_quality_problems(),
        color: 'var(--chart-2)',
      },
    }),
    []
  )

  const hourlyChartConfig = useMemo<ChartConfig>(
    () => ({
      avgLatency: {
        label: m.insights_hourly_latency(),
        color: 'var(--chart-1)',
      },
    }),
    []
  )

  const { data: qualityData, isLoading: qualityLoading } = useQuery({
    queryKey: ['insights-quality'],
    queryFn: getNetworkQualityOverTime,
  })

  const { data: hourlyData, isLoading: hourlyLoading } = useQuery({
    queryKey: ['insights-hourly'],
    queryFn: getHourlyQuality,
  })

  const isEmpty =
    !qualityLoading &&
    !hourlyLoading &&
    (!qualityData || qualityData.length === 0) &&
    (!hourlyData || hourlyData.length === 0)

  return (
    <div className="h-full overflow-y-auto">
      <SessionHeader title={m.nav_history()} facts={[m.insights_description()]} />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        {isEmpty ? (
          <Panel>
            <EmptyState title={m.insights_empty_title()}>
              {m.insights_empty_description()}
            </EmptyState>
          </Panel>
        ) : (
          <>
            <Panel label={m.insights_quality_title()}>
              {qualityLoading ? (
                <Skeleton className="h-64" />
              ) : !qualityData || qualityData.length === 0 ? (
                <EmptyState compact title={m.insights_quality_empty()} />
              ) : (
                <ChartContainer config={qualityChartConfig} className="h-64 w-full">
                  <LineChart
                    data={qualityData.map(p => ({
                      date: formatDate(p.startedAt),
                      avgLatency: p.avgLatency != null ? Number(p.avgLatency.toFixed(1)) : null,
                      problemHopPercent: Number((p.problemHopRatio * 100).toFixed(1)),
                      gameName: p.gameName,
                    }))}
                    margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="latency" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="percent" orientation="right" tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line
                      yAxisId="latency"
                      type="monotone"
                      dataKey="avgLatency"
                      stroke="var(--color-avgLatency)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                    <Line
                      yAxisId="percent"
                      type="monotone"
                      dataKey="problemHopPercent"
                      stroke="var(--color-problemHopPercent)"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ChartContainer>
              )}
            </Panel>

            <Panel label={m.insights_hourly_title()}>
              {hourlyLoading ? (
                <Skeleton className="h-56" />
              ) : !hourlyData || hourlyData.length === 0 ? (
                <EmptyState compact title={m.insights_hourly_empty()} />
              ) : (
                <ChartContainer config={hourlyChartConfig} className="h-56 w-full">
                  <BarChart
                    data={hourlyData.map(h => ({
                      hour: `${String(h.hour).padStart(2, '0')}h`,
                      avgLatency: h.avgLatency != null ? Number(h.avgLatency.toFixed(1)) : 0,
                      sessionCount: h.sessionCount,
                    }))}
                    margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey="avgLatency"
                      fill="var(--color-avgLatency)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ChartContainer>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

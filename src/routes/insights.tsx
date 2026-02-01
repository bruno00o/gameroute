import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiExpandUpDownLine,
  RiBarChartLine,
  RiInboxLine,
} from '@remixicon/react'
import {
  type SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  Line,
  LineChart,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'

import * as m from '@/paraglide/messages'
import type { ServerStability } from '@/types/backend'
import {
  getNetworkQualityOverTime,
  getHourlyQuality,
  getServerStability,
} from '@/lib/tauri'
import { formatMs, formatLoss, formatDate, latencyColor } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'

export const Route = createFileRoute('/insights')({
  component: InsightsPage,
})

const STABILITY_PAGE_SIZE = 10

const qualityChartConfig = {
  avgLatency: {
    label: 'Avg Latency (ms)',
    color: 'oklch(0.65 0.15 250)',
  },
  problemHopPercent: {
    label: 'Problem Hop %',
    color: 'oklch(0.65 0.2 25)',
  },
} satisfies ChartConfig

const hourlyChartConfig = {
  avgLatency: {
    label: 'Avg Latency (ms)',
    color: 'oklch(0.65 0.15 250)',
  },
} satisfies ChartConfig

const stabilityColumnHelper = createColumnHelper<ServerStability>()

function InsightsPage() {
  const [stabilitySorting, setStabilitySorting] = useState<SortingState>([])

  const { data: qualityData, isLoading: qualityLoading } = useQuery({
    queryKey: ['insights-quality'],
    queryFn: getNetworkQualityOverTime,
  })

  const { data: hourlyData, isLoading: hourlyLoading } = useQuery({
    queryKey: ['insights-hourly'],
    queryFn: getHourlyQuality,
  })

  const { data: stabilityData, isLoading: stabilityLoading } = useQuery({
    queryKey: ['insights-stability'],
    queryFn: getServerStability,
  })

  const isEmpty =
    !qualityLoading &&
    !hourlyLoading &&
    !stabilityLoading &&
    (!qualityData || qualityData.length === 0) &&
    (!hourlyData || hourlyData.length === 0) &&
    (!stabilityData || stabilityData.length === 0)

  const stabilityColumns = useMemo(
    () => [
      stabilityColumnHelper.accessor('ip', {
        header: () => m.insights_col_ip(),
        cell: info => <span className="font-mono text-xs">{info.getValue()}</span>,
      }),
      stabilityColumnHelper.accessor('isp', {
        header: () => m.insights_col_isp(),
        cell: info => (
          <span className="text-xs">{info.getValue() ?? '-'}</span>
        ),
      }),
      stabilityColumnHelper.accessor('country', {
        header: () => m.insights_col_country(),
        cell: info => (
          <span className="text-xs">{info.getValue() ?? '-'}</span>
        ),
      }),
      stabilityColumnHelper.accessor('avgLatency', {
        header: () => m.insights_col_avg_latency(),
        cell: info => (
          <span className={latencyColor(info.getValue())}>
            {formatMs(info.getValue())} ms
          </span>
        ),
      }),
      stabilityColumnHelper.accessor('avgPacketLoss', {
        header: () => m.insights_col_avg_loss(),
        cell: info => formatLoss(info.getValue()),
      }),
      stabilityColumnHelper.accessor('tracerouteCount', {
        header: () => m.insights_col_traceroutes(),
        cell: info => <Badge variant="secondary">{info.getValue()}</Badge>,
      }),
      stabilityColumnHelper.accessor('problemHopRatio', {
        header: () => m.insights_col_problems(),
        cell: info => `${(info.getValue() * 100).toFixed(0)}%`,
      }),
    ],
    [],
  )

  const stabilityTable = useReactTable({
    data: stabilityData ?? [],
    columns: stabilityColumns,
    state: { sorting: stabilitySorting },
    onSortingChange: setStabilitySorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: STABILITY_PAGE_SIZE } },
  })

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.insights_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.insights_description()}</p>

      {isEmpty ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <RiBarChartLine className="text-muted-foreground size-10" />
          <p className="text-muted-foreground text-sm font-medium">
            {m.insights_empty_title()}
          </p>
          <p className="text-muted-foreground text-sm">{m.insights_empty_description()}</p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{m.insights_quality_title()}</CardTitle>
              </CardHeader>
              <CardContent>
                {qualityLoading ? (
                  <Skeleton className="h-64" />
                ) : !qualityData || qualityData.length === 0 ? (
                  <EmptyChart message={m.insights_quality_empty()} />
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
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{m.insights_hourly_title()}</CardTitle>
              </CardHeader>
              <CardContent>
                {hourlyLoading ? (
                  <Skeleton className="h-56" />
                ) : !hourlyData || hourlyData.length === 0 ? (
                  <EmptyChart message={m.insights_hourly_empty()} />
                ) : (
                  <ChartContainer config={hourlyChartConfig} className="h-56 w-full">
                    <BarChart
                      data={hourlyData.map(h => ({
                        hour: `${String(h.hour).padStart(2, '0')}h`,
                        avgLatency:
                          h.avgLatency != null ? Number(h.avgLatency.toFixed(1)) : 0,
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
              </CardContent>
            </Card>
          </div>

          <div className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>{m.insights_stability_title()}</CardTitle>
              </CardHeader>
              <CardContent>
                {stabilityLoading ? (
                  <Skeleton className="h-56" />
                ) : !stabilityData || stabilityData.length === 0 ? (
                  <EmptyChart message={m.insights_stability_empty()} />
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        {stabilityTable.getHeaderGroups().map(headerGroup => (
                          <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map(header => (
                              <TableHead
                                key={header.id}
                                className={header.column.getCanSort() ? 'cursor-pointer select-none' : ''}
                                onClick={header.column.getToggleSortingHandler()}
                              >
                                <div className="flex items-center gap-1">
                                  {header.isPlaceholder
                                    ? null
                                    : flexRender(header.column.columnDef.header, header.getContext())}
                                  {header.column.getCanSort() && <SortIndicator sorted={header.column.getIsSorted()} />}
                                </div>
                              </TableHead>
                            ))}
                          </TableRow>
                        ))}
                      </TableHeader>
                      <TableBody>
                        {stabilityTable.getRowModel().rows.map(row => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map(cell => (
                              <TableCell key={cell.id}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {stabilityTable.getPageCount() > 1 && (
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">
                          {stabilityTable.getState().pagination.pageIndex + 1} / {stabilityTable.getPageCount()}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!stabilityTable.getCanPreviousPage()}
                            onClick={() => stabilityTable.previousPage()}
                          >
                            <RiArrowLeftSLine className="size-4" data-icon="inline-start" />
                            {m.sessions_prev()}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!stabilityTable.getCanNextPage()}
                            onClick={() => stabilityTable.nextPage()}
                          >
                            {m.sessions_next()}
                            <RiArrowRightSLine className="size-4" data-icon="inline-end" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function SortIndicator({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <RiArrowUpSLine className="size-4" />
  if (sorted === 'desc') return <RiArrowDownSLine className="size-4" />
  return <RiExpandUpDownLine className="text-muted-foreground size-3.5" />
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-2">
      <RiInboxLine className="text-muted-foreground size-6" />
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  )
}

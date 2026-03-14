import { useCallback, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
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
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiClipboardLine,
  RiDownloadLine,
  RiExpandUpDownLine,
  RiEarthLine,
  RiGamepadLine,
  RiGlobalLine,
  RiInboxLine,
  RiRouteLine,
  RiAlertLine,
  RiTimeLine,
  RiBarChartLine,
} from '@remixicon/react'
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
import type { RecurringProblemHop, NetworkMapEntry, ServerStability } from '@/types/backend'
import {
  getNetworkOverviewStats,
  getNetworkMapData,
  getRecurringProblemHops,
  getNetworkQualityOverTime,
  getHourlyQuality,
  getServerStability,
} from '@/lib/tauri'
import { toast } from 'sonner'

import { useSettingsStore } from '@/stores/settings-store'
import { formatMs, formatLoss, formatDate, latencyColor } from '@/lib/format'
import { generateNetworkExport } from '@/lib/export-llm'
import { exportServerStability } from '@/lib/export-csv'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Map, MapMarker, MarkerContent, MarkerTooltip, MapPopup, MapControls } from '@/components/ui/map'
import { ExpandableMap } from '@/components/expandable-map'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'

export const Route = createFileRoute('/network')({
  component: NetworkPage,
})

function NetworkPage() {
  const { data: exportStats } = useQuery({
    queryKey: ['network-overview-stats'],
    queryFn: getNetworkOverviewStats,
  })
  const { data: exportProblemHops } = useQuery({
    queryKey: ['network-problem-hops'],
    queryFn: getRecurringProblemHops,
  })
  const { data: exportStability } = useQuery({
    queryKey: ['insights-stability'],
    queryFn: getServerStability,
  })

  const handleExportLlm = useCallback(async () => {
    if (!exportStats) return
    try {
      const text = generateNetworkExport(
        exportStats,
        exportProblemHops ?? [],
        exportStability ?? [],
      )
      await navigator.clipboard.writeText(text)
      toast.success(m.export_llm_copied())
    } catch {
      toast.error(m.export_llm_error())
    }
  }, [exportStats, exportProblemHops, exportStability])

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{m.network_title()}</h1>
          <p className="text-muted-foreground mt-2">{m.network_description()}</p>
        </div>
        {exportStats && exportStats.totalTraceroutes > 0 && (
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportServerStability(exportStability ?? [])}
            >
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
        )}
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <TabsList variant="line">
          <TabsTrigger value="overview">{m.network_tab_overview()}</TabsTrigger>
          <TabsTrigger value="trends">{m.network_tab_trends()}</TabsTrigger>
          <TabsTrigger value="servers">{m.network_tab_servers()}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="trends">
          <TrendsTab />
        </TabsContent>
        <TabsContent value="servers">
          <ServersTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ─── Overview Tab (former Network page) ─── */

const HOPS_PAGE_SIZE = 10
const hopColumnHelper = createColumnHelper<RecurringProblemHop>()

function OverviewTab() {
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const [gsHopSorting, setGsHopSorting] = useState<SortingState>([])
  const [otherHopSorting, setOtherHopSorting] = useState<SortingState>([])

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['network-overview-stats'],
    queryFn: getNetworkOverviewStats,
  })

  const { data: mapData, isLoading: mapLoading } = useQuery({
    queryKey: ['network-map-data'],
    queryFn: getNetworkMapData,
  })

  const { data: problemHops, isLoading: hopsLoading } = useQuery({
    queryKey: ['network-problem-hops'],
    queryFn: getRecurringProblemHops,
  })

  const isEmpty =
    !statsLoading && stats && stats.uniqueServerIps === 0 && stats.totalTraceroutes === 0

  const { gsHops, otherHops } = useMemo(() => {
    if (!problemHops) return { gsHops: [], otherHops: [] }
    return {
      gsHops: problemHops.filter(h => h.isGameServerRoute),
      otherHops: problemHops.filter(h => !h.isGameServerRoute),
    }
  }, [problemHops])

  const hopColumns = useMemo(
    () => [
      hopColumnHelper.accessor('ip', {
        header: () => m.network_col_ip(),
        cell: info => <span className="font-mono text-sm">{info.getValue()}</span>,
      }),
      hopColumnHelper.accessor('isp', {
        header: () => m.network_col_isp(),
        cell: info => {
          const isp = info.getValue()
          const asn = info.row.original.asn
          if (!isp && !asn) return '-'
          if (!isp) return <span className="font-mono text-xs">{asn}</span>
          if (!asn) return isp
          return (
            <span>
              {isp}{' '}
              <span className="text-muted-foreground text-xs">({asn})</span>
            </span>
          )
        },
      }),
      hopColumnHelper.accessor('occurrenceCount', {
        header: () => m.network_col_occurrences(),
        cell: info => <Badge variant="secondary">{info.getValue()}</Badge>,
      }),
      hopColumnHelper.accessor('avgLatency', {
        header: () => advancedMode ? m.network_col_avg_latency() : m.simple_latency(),
        cell: info => (
          <span className={latencyColor(info.getValue())}>
            {formatMs(info.getValue())} ms
          </span>
        ),
      }),
      hopColumnHelper.accessor('avgPacketLoss', {
        header: () => advancedMode ? m.network_col_avg_loss() : m.simple_loss(),
        cell: info => formatLoss(info.getValue()),
      }),
    ],
    [advancedMode],
  )

  const gsHopTable = useReactTable({
    data: gsHops,
    columns: hopColumns,
    state: { sorting: gsHopSorting },
    onSortingChange: setGsHopSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: HOPS_PAGE_SIZE } },
  })

  const otherHopTable = useReactTable({
    data: otherHops,
    columns: hopColumns,
    state: { sorting: otherHopSorting },
    onSortingChange: setOtherHopSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: HOPS_PAGE_SIZE } },
  })

  const mappableEntries = useMemo(
    () => (mapData ?? []).filter(e => e.lat != null && e.lon != null),
    [mapData],
  )

  if (isEmpty) {
    return (
      <div className="mt-16 flex flex-col items-center gap-3 text-center">
        <RiGlobalLine className="text-muted-foreground size-10" />
        <h2 className="text-lg font-medium">{m.network_empty_title()}</h2>
        <p className="text-muted-foreground text-sm">{m.network_empty_description()}</p>
      </div>
    )
  }

  return (
    <>
      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title={m.network_unique_ips()}
          value={stats?.uniqueServerIps}
          icon={<RiGlobalLine className="text-muted-foreground size-4" />}
          isLoading={statsLoading}
        />
        <StatCard
          title={m.network_total_traceroutes()}
          value={stats?.totalTraceroutes}
          icon={<RiRouteLine className="text-muted-foreground size-4" />}
          isLoading={statsLoading}
        />
        <StatCard
          title={advancedMode ? m.network_total_problem_hops() : m.simple_total_problem_hops()}
          value={stats?.totalProblemHops}
          icon={<RiAlertLine className="text-muted-foreground size-4" />}
          isLoading={statsLoading}
        />
        <StatCard
          title={advancedMode ? m.network_avg_latency() : m.simple_avg_latency()}
          value={stats?.avgLatency != null ? `${stats.avgLatency.toFixed(1)} ms` : '-'}
          icon={<RiTimeLine className="text-muted-foreground size-4" />}
          isLoading={statsLoading}
        />
      </div>

      {/* Server Map */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold">{m.network_map_title()}</h2>
        {mapLoading ? (
          <Skeleton className="mt-3 h-80" />
        ) : mappableEntries.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <RiEarthLine className="text-muted-foreground size-8" />
            <p className="text-muted-foreground text-sm">{m.network_map_empty()}</p>
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg border">
            <ServerMapView entries={mappableEntries} />
          </div>
        )}
      </div>

      {/* Problem Hops split */}
      <div className="mt-8 space-y-8">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <RiGamepadLine className="size-5 text-amber-500" />
            {m.network_game_server_hops_title()}
          </h2>
          {hopsLoading ? (
            <div className="mt-3">
              <Skeleton className="h-40" />
            </div>
          ) : gsHops.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 text-center">
              <RiInboxLine className="text-muted-foreground size-6" />
              <p className="text-muted-foreground text-xs">
                {m.network_no_game_server_issues()}
              </p>
            </div>
          ) : (
            <HopTable table={gsHopTable} />
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold">{m.network_other_hops_title()}</h2>
          {hopsLoading ? (
            <div className="mt-3">
              <Skeleton className="h-40" />
            </div>
          ) : otherHops.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 text-center">
              <RiInboxLine className="text-muted-foreground size-6" />
              <p className="text-muted-foreground text-xs">
                {m.network_problem_hops_empty()}
              </p>
            </div>
          ) : (
            <HopTable table={otherHopTable} />
          )}
        </div>
      </div>
    </>
  )
}

/* ─── Trends Tab (former Insights charts) ─── */

function TrendsTab() {
  const qualityChartConfig = useMemo<ChartConfig>(
    () => ({
      avgLatency: {
        label: m.insights_quality_latency(),
        color: 'oklch(0.65 0.15 250)',
      },
      problemHopPercent: {
        label: m.insights_quality_problems(),
        color: 'oklch(0.65 0.2 25)',
      },
    }),
    [],
  )

  const hourlyChartConfig = useMemo<ChartConfig>(
    () => ({
      avgLatency: {
        label: m.insights_hourly_latency(),
        color: 'oklch(0.65 0.15 250)',
      },
    }),
    [],
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

  if (isEmpty) {
    return (
      <div className="mt-16 flex flex-col items-center gap-3 text-center">
        <RiBarChartLine className="text-muted-foreground size-10" />
        <h2 className="text-lg font-medium">{m.insights_empty_title()}</h2>
        <p className="text-muted-foreground text-sm">{m.insights_empty_description()}</p>
      </div>
    )
  }

  return (
    <>
      <div className="mt-4">
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
    </>
  )
}

/* ─── Servers Tab (stability table + map from Insights) ─── */

const STABILITY_PAGE_SIZE = 10
const stabilityColumnHelper = createColumnHelper<ServerStability>()

function ServersTab() {
  const [stabilitySorting, setStabilitySorting] = useState<SortingState>([])

  const { data: stabilityData, isLoading: stabilityLoading } = useQuery({
    queryKey: ['insights-stability'],
    queryFn: getServerStability,
  })

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

  const isEmpty = !stabilityLoading && (!stabilityData || stabilityData.length === 0)

  if (isEmpty) {
    return (
      <div className="mt-16 flex flex-col items-center gap-3 text-center">
        <RiInboxLine className="text-muted-foreground size-10" />
        <h2 className="text-lg font-medium">{m.insights_stability_empty()}</h2>
        <p className="text-muted-foreground text-sm">{m.insights_empty_description()}</p>
      </div>
    )
  }

  return (
    <>
      <StabilityMapSection data={stabilityData} isLoading={stabilityLoading} />

      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>{m.insights_stability_title()}</CardTitle>
          </CardHeader>
          <CardContent>
            {stabilityLoading ? (
              <Skeleton className="h-56" />
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
                  <PaginationControls
                    page={stabilityTable.getState().pagination.pageIndex}
                    totalPages={stabilityTable.getPageCount()}
                    onPrev={() => stabilityTable.previousPage()}
                    onNext={() => stabilityTable.nextPage()}
                    canPrev={stabilityTable.getCanPreviousPage()}
                    canNext={stabilityTable.getCanNextPage()}
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

/* ─── Shared Components ─── */

function PaginationControls({
  page,
  totalPages,
  onPrev,
  onNext,
  canPrev,
  canNext,
}: {
  page: number
  totalPages: number
  onPrev: () => void
  onNext: () => void
  canPrev: boolean
  canNext: boolean
}) {
  return (
    <div className="mt-3 flex items-center justify-between">
      <span className="text-muted-foreground text-xs">
        {page + 1} / {totalPages}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={!canPrev} onClick={onPrev}>
          <RiArrowLeftSLine className="size-4" data-icon="inline-start" />
          {m.sessions_prev()}
        </Button>
        <Button variant="outline" size="sm" disabled={!canNext} onClick={onNext}>
          {m.sessions_next()}
          <RiArrowRightSLine className="size-4" data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

function HopTable({
  table,
}: {
  table: ReturnType<typeof useReactTable<RecurringProblemHop>>
}) {
  return (
    <div className="mt-3">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(headerGroup => (
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
                    {header.column.getCanSort() && (
                      <SortIndicator sorted={header.column.getIsSorted()} />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map(row => (
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
      {table.getPageCount() > 1 && (
        <PaginationControls
          page={table.getState().pagination.pageIndex}
          totalPages={table.getPageCount()}
          onPrev={() => table.previousPage()}
          onNext={() => table.nextPage()}
          canPrev={table.getCanPreviousPage()}
          canNext={table.getCanNextPage()}
        />
      )}
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  isLoading,
}: {
  title: string
  value: string | number | undefined
  icon: React.ReactNode
  isLoading: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <span className="text-2xl font-bold">{value ?? '-'}</span>
        )}
      </CardContent>
    </Card>
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

function ServerMapContent({ entries }: { entries: NetworkMapEntry[] }) {
  const [selectedIp, setSelectedIp] = useState<string | null>(null)

  const selectedEntry = useMemo(
    () => entries.find(e => e.ip === selectedIp) ?? null,
    [entries, selectedIp],
  )

  const center = useMemo<[number, number]>(() => {
    if (entries.length === 0) return [0, 20]
    const avgLon = entries.reduce((s, e) => s + (e.lon ?? 0), 0) / entries.length
    const avgLat = entries.reduce((s, e) => s + (e.lat ?? 0), 0) / entries.length
    return [avgLon, avgLat]
  }, [entries])

  return (
    <Map center={center} zoom={2}>
      <MapControls />
      {entries.map(entry => (
        <MapMarker
          key={entry.ip}
          longitude={entry.lon!}
          latitude={entry.lat!}
          onClick={() => setSelectedIp(prev => (prev === entry.ip ? null : entry.ip))}
        >
          <MarkerContent>
            <div
              className={cn(
                'size-3.5 rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.1)] transition-transform hover:scale-150',
                entry.isGameServer ? 'bg-blue-500' : 'bg-slate-400',
              )}
            />
          </MarkerContent>
          <MarkerTooltip>
            <div>
              <span className="font-mono font-medium">{entry.ip}</span>
              {entry.isp && <span className="ml-1.5 opacity-70">· {entry.isp}</span>}
            </div>
          </MarkerTooltip>
        </MapMarker>
      ))}
      {selectedEntry && (
        <MapPopup
          longitude={selectedEntry.lon!}
          latitude={selectedEntry.lat!}
          onClose={() => setSelectedIp(null)}
          closeButton
          className="w-56 p-0"
        >
          <div className="space-y-1.5 p-3">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-xs font-medium">
                {selectedEntry.ip}
              </span>
              {selectedEntry.isGameServer && (
                <RiGamepadLine className="size-3.5 shrink-0 text-amber-500" />
              )}
            </div>
            {(selectedEntry.city || selectedEntry.country) && (
              <p className="text-muted-foreground text-xs">
                {[selectedEntry.city, selectedEntry.country].filter(Boolean).join(', ')}
              </p>
            )}
            {selectedEntry.isp && (
              <p className="text-muted-foreground text-xs">{selectedEntry.isp}</p>
            )}
            <div className="flex items-center gap-2 pt-1 text-xs">
              <span className="text-muted-foreground">
                {m.network_map_sessions({ count: String(selectedEntry.sessionCount) })}
              </span>
              {selectedEntry.asn && (
                <Badge variant="outline" className="px-1 py-0 text-[10px]">
                  {selectedEntry.asn}
                </Badge>
              )}
            </div>
          </div>
        </MapPopup>
      )}
    </Map>
  )
}

function ServerMapView({ entries }: { entries: NetworkMapEntry[] }) {
  return (
    <>
      <ExpandableMap
        className="h-80"
        renderExpanded={() => <ServerMapContent entries={entries} />}
      >
        <ServerMapContent entries={entries} />
      </ExpandableMap>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-blue-500" />
          {m.network_map_legend_game_server()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-slate-400" />
          {m.network_map_legend_other()}
        </span>
      </div>
    </>
  )
}

function StabilityMapSection({
  data,
  isLoading,
}: {
  data: ServerStability[] | undefined
  isLoading: boolean
}) {
  const mappable = useMemo(
    () => (data ?? []).filter(s => s.lat != null && s.lon != null),
    [data],
  )

  if (isLoading) {
    return (
      <div className="mt-4">
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (mappable.length === 0) return null

  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>{m.insights_stability_map_title()}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border">
            <ExpandableMap
              className="h-64"
              renderExpanded={() => <StabilityMapContent servers={mappable} />}
            >
              <StabilityMapContent servers={mappable} />
            </ExpandableMap>
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-emerald-500" />
              {m.network_map_legend_stable()}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-amber-500" />
              {m.network_map_legend_some_issues()}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-500" />
              {m.network_map_legend_problematic()}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StabilityMapContent({ servers }: { servers: ServerStability[] }) {
  const [selectedIp, setSelectedIp] = useState<string | null>(null)

  const selected = useMemo(
    () => servers.find(s => s.ip === selectedIp) ?? null,
    [servers, selectedIp],
  )

  const center = useMemo<[number, number]>(() => {
    if (servers.length === 0) return [0, 20]
    return [
      servers.reduce((s, e) => s + (e.lon ?? 0), 0) / servers.length,
      servers.reduce((s, e) => s + (e.lat ?? 0), 0) / servers.length,
    ]
  }, [servers])

  return (
    <Map center={center} zoom={2}>
      <MapControls />
      {servers.map(server => {
        const ratio = server.problemHopRatio
        const color =
          ratio > 0.3
            ? 'bg-red-500'
            : ratio > 0.1
              ? 'bg-amber-500'
              : 'bg-emerald-500'
        return (
          <MapMarker
            key={server.ip}
            longitude={server.lon!}
            latitude={server.lat!}
            onClick={() => setSelectedIp(prev => (prev === server.ip ? null : server.ip))}
          >
            <MarkerContent>
              <div
                className={cn(
                  'size-3.5 rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.1)] transition-transform hover:scale-150',
                  color,
                )}
              />
            </MarkerContent>
            <MarkerTooltip>
              <div>
                <span className="font-mono font-medium">{server.ip}</span>
                {server.isp && <span className="ml-1.5 opacity-70">· {server.isp}</span>}
              </div>
            </MarkerTooltip>
          </MapMarker>
        )
      })}
      {selected && (
        <MapPopup
          longitude={selected.lon!}
          latitude={selected.lat!}
          onClose={() => setSelectedIp(null)}
          closeButton
          className="w-56 p-0"
        >
          <div className="space-y-1.5 p-3">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-xs font-medium">{selected.ip}</span>
              {selected.isGameServer && (
                <RiGamepadLine className="size-3.5 shrink-0 text-amber-500" />
              )}
            </div>
            {selected.country && (
              <p className="text-muted-foreground text-xs">{selected.country}</p>
            )}
            {selected.isp && (
              <p className="text-muted-foreground text-xs">{selected.isp}</p>
            )}
            <div className="flex items-center gap-3 pt-1 text-xs">
              <span className={latencyColor(selected.avgLatency)}>
                {formatMs(selected.avgLatency)} ms
              </span>
              <span className="text-muted-foreground">
                {m.insights_map_problems({ percent: (selected.problemHopRatio * 100).toFixed(0) })}
              </span>
            </div>
          </div>
        </MapPopup>
      )}
    </Map>
  )
}

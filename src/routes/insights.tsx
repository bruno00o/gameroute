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
  RiGamepadLine,
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
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Map, MapMarker, MarkerContent, MarkerTooltip, MapPopup, MapControls } from '@/components/ui/map'
import { ExpandableMap } from '@/components/expandable-map'
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

const stabilityColumnHelper = createColumnHelper<ServerStability>()

function InsightsPage() {
  const [stabilitySorting, setStabilitySorting] = useState<SortingState>([])

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
          <h2 className="text-lg font-medium">{m.insights_empty_title()}</h2>
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

          <StabilityMapSection data={stabilityData} isLoading={stabilityLoading} />

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
      <div className="mt-6">
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (mappable.length === 0) return null

  return (
    <div className="mt-6">
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

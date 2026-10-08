import { useCallback, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { RiClipboardLine, RiDownloadLine, RiGamepadLine } from '@remixicon/react'
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
import { formatMs, formatNumber, formatPercent, formatDate } from '@/lib/format'
import { generateNetworkExport } from '@/lib/export-llm'
import { exportServerStability } from '@/lib/export-csv'
import { cn } from '@/lib/utils'
import { Map, MapMarker, MarkerContent, MarkerTooltip, MapPopup, MapControls } from '@/components/ui/map'
import { ExpandableMap } from '@/components/expandable-map'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
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
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Fact, FactRow } from '@/components/fact-row'
import { Panel } from '@/components/panel'

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
            <Button size="sm" onClick={() => exportServerStability(exportStability ?? [])}>
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

const TABLE_PAGE_SIZE = 10

function OverviewTab() {
  const advancedMode = useSettingsStore(s => s.advancedMode)

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

  const hopColumns = useMemo<DataTableColumn<RecurringProblemHop>[]>(
    () => [
      {
        key: 'ip',
        label: m.network_col_ip(),
        mono: true,
      },
      {
        key: 'isp',
        label: m.network_col_isp(),
        sortValue: hop => hop.isp ?? hop.asn,
        render: hop => {
          if (!hop.isp) return hop.asn && <span className="font-mono text-xs">{hop.asn}</span>
          if (!hop.asn) return hop.isp
          return (
            <span>
              {hop.isp} <span className="text-muted-foreground text-xs">({hop.asn})</span>
            </span>
          )
        },
      },
      {
        key: 'occurrenceCount',
        label: m.network_col_occurrences(),
        align: 'end',
        mono: true,
        render: hop => formatNumber(hop.occurrenceCount),
      },
      {
        key: 'avgLatency',
        label: advancedMode ? m.network_col_avg_latency() : m.simple_latency(),
        align: 'end',
        mono: true,
        render: hop => formatMs(hop.avgLatency),
      },
      {
        key: 'avgPacketLoss',
        label: advancedMode ? m.network_col_avg_loss() : m.simple_loss(),
        align: 'end',
        mono: true,
        render: hop => formatPercent(hop.avgPacketLoss),
      },
    ],
    [advancedMode]
  )

  const mappableEntries = useMemo(
    () => (mapData ?? []).filter(e => e.lat != null && e.lon != null),
    [mapData]
  )

  if (isEmpty) {
    return (
      <EmptyState className="mt-6" title={m.network_empty_title()}>
        {m.network_empty_description()}
      </EmptyState>
    )
  }

  const statValue = (value: string | number | undefined) =>
    statsLoading ? <Skeleton className="h-5 w-16" /> : value

  return (
    <div className="mt-4 flex flex-col gap-6">
      <FactRow>
        <Fact label={m.network_unique_ips()}>{statValue(stats?.uniqueServerIps)}</Fact>
        <Fact label={m.network_total_traceroutes()}>{statValue(stats?.totalTraceroutes)}</Fact>
        <Fact label={advancedMode ? m.network_total_problem_hops() : m.simple_total_problem_hops()}>
          {statValue(stats?.totalProblemHops)}
        </Fact>
        <Fact label={advancedMode ? m.network_avg_latency() : m.simple_avg_latency()}>
          {statValue(stats ? formatMs(stats.avgLatency) : undefined)}
        </Fact>
      </FactRow>

      <Panel label={m.network_map_title()}>
        {mapLoading ? (
          <Skeleton className="h-80" />
        ) : mappableEntries.length === 0 ? (
          <EmptyState compact title={m.network_map_empty()} />
        ) : (
          <ServerMapView entries={mappableEntries} />
        )}
      </Panel>

      <Panel label={m.network_game_server_hops_title()} flush>
        <DataTable
          columns={hopColumns}
          rows={gsHops}
          getRowId={hop => hop.ip}
          pageSize={TABLE_PAGE_SIZE}
          loading={hopsLoading}
          empty={<EmptyState compact title={m.network_no_game_server_issues()} />}
        />
      </Panel>

      <Panel label={m.network_other_hops_title()} flush>
        <DataTable
          columns={hopColumns}
          rows={otherHops}
          getRowId={hop => hop.ip}
          pageSize={TABLE_PAGE_SIZE}
          loading={hopsLoading}
          empty={<EmptyState compact title={m.network_problem_hops_empty()} />}
        />
      </Panel>
    </div>
  )
}

/* ─── Trends Tab (former Insights charts) ─── */

function TrendsTab() {
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

  if (isEmpty) {
    return (
      <EmptyState className="mt-6" title={m.insights_empty_title()}>
        {m.insights_empty_description()}
      </EmptyState>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
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
              <Bar dataKey="avgLatency" fill="var(--color-avgLatency)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </Panel>
    </div>
  )
}

/* ─── Servers Tab (stability table + map from Insights) ─── */

function ServersTab() {
  const { data: stabilityData, isLoading: stabilityLoading } = useQuery({
    queryKey: ['insights-stability'],
    queryFn: getServerStability,
  })

  const stabilityColumns = useMemo<DataTableColumn<ServerStability>[]>(
    () => [
      {
        key: 'ip',
        label: m.insights_col_ip(),
        mono: true,
      },
      {
        key: 'isp',
        label: m.insights_col_isp(),
      },
      {
        key: 'country',
        label: m.insights_col_country(),
      },
      {
        key: 'avgLatency',
        label: m.insights_col_avg_latency(),
        align: 'end',
        mono: true,
        render: server => formatMs(server.avgLatency),
      },
      {
        key: 'avgPacketLoss',
        label: m.insights_col_avg_loss(),
        align: 'end',
        mono: true,
        render: server => formatPercent(server.avgPacketLoss),
      },
      {
        key: 'tracerouteCount',
        label: m.insights_col_traceroutes(),
        align: 'end',
        mono: true,
        render: server => formatNumber(server.tracerouteCount),
      },
      {
        key: 'problemHopRatio',
        label: m.insights_col_problems(),
        align: 'end',
        mono: true,
        render: server => formatPercent(server.problemHopRatio * 100),
      },
    ],
    []
  )

  const isEmpty = !stabilityLoading && (!stabilityData || stabilityData.length === 0)

  if (isEmpty) {
    return (
      <EmptyState className="mt-6" title={m.insights_stability_empty()}>
        {m.network_empty_description()}
      </EmptyState>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-6">
      <StabilityMapSection data={stabilityData} isLoading={stabilityLoading} />

      <Panel label={m.insights_stability_title()} flush>
        <DataTable
          columns={stabilityColumns}
          rows={stabilityData ?? []}
          getRowId={server => server.ip}
          pageSize={TABLE_PAGE_SIZE}
          loading={stabilityLoading}
        />
      </Panel>
    </div>
  )
}

/* ─── Shared Components ─── */

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
                entry.isGameServer ? 'bg-foreground' : 'bg-route-b',
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
                <RiGamepadLine className="size-3.5 shrink-0 text-muted-foreground" />
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
      <div className="overflow-hidden rounded-sm border">
        <ExpandableMap
          className="h-80"
          renderExpanded={() => <ServerMapContent entries={entries} />}
        >
          <ServerMapContent entries={entries} />
        </ExpandableMap>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground" />
          {m.network_map_legend_game_server()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-route-b" />
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
  const mappable = useMemo(() => (data ?? []).filter(s => s.lat != null && s.lon != null), [data])

  if (isLoading) return <Skeleton className="h-64" />

  if (mappable.length === 0) return null

  return (
    <Panel label={m.insights_stability_map_title()}>
      <div className="overflow-hidden rounded-sm border">
        <ExpandableMap
          className="h-64"
          renderExpanded={() => <StabilityMapContent servers={mappable} />}
        >
          <StabilityMapContent servers={mappable} />
        </ExpandableMap>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground" />
          {m.network_map_legend_game_server()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-route-b" />
          {m.network_map_legend_other()}
        </span>
      </div>
    </Panel>
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
        const color = server.isGameServer ? 'bg-foreground' : 'bg-route-b'
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
                <RiGamepadLine className="size-3.5 shrink-0 text-muted-foreground" />
              )}
            </div>
            {selected.country && (
              <p className="text-muted-foreground text-xs">{selected.country}</p>
            )}
            {selected.isp && (
              <p className="text-muted-foreground text-xs">{selected.isp}</p>
            )}
            <div className="flex items-center gap-3 pt-1 text-xs">
              <span className="font-mono tabular-nums">
                {formatMs(selected.avgLatency)}
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

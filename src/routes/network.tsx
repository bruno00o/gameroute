import { useMemo, useState } from 'react'
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
  RiExpandUpDownLine,
  RiEarthLine,
  RiGamepadLine,
  RiGlobalLine,
  RiInboxLine,
  RiRouteLine,
  RiAlertLine,
  RiTimeLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { RecurringProblemHop, NetworkMapEntry } from '@/types/backend'
import {
  getNetworkOverviewStats,
  getNetworkMapData,
  getRecurringProblemHops,
} from '@/lib/tauri'
import { formatMs, formatLoss, latencyColor } from '@/lib/format'
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

export const Route = createFileRoute('/network')({
  component: NetworkPage,
})

const HOPS_PAGE_SIZE = 10

const hopColumnHelper = createColumnHelper<RecurringProblemHop>()

function NetworkPage() {
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
        header: () => m.network_col_avg_latency(),
        cell: info => (
          <span className={latencyColor(info.getValue())}>
            {formatMs(info.getValue())} ms
          </span>
        ),
      }),
      hopColumnHelper.accessor('avgPacketLoss', {
        header: () => m.network_col_avg_loss(),
        cell: info => formatLoss(info.getValue()),
      }),
    ],
    [],
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

  // Filter entries that have coordinates for the map
  const mappableEntries = useMemo(
    () => (mapData ?? []).filter(e => e.lat != null && e.lon != null),
    [mapData],
  )

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.network_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.network_description()}</p>

      {isEmpty ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <RiGlobalLine className="text-muted-foreground size-10" />
          <h2 className="text-lg font-medium">{m.network_empty_title()}</h2>
          <p className="text-muted-foreground text-sm">{m.network_empty_description()}</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="mt-6 grid grid-cols-4 gap-4">
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
              title={m.network_total_problem_hops()}
              value={stats?.totalProblemHops}
              icon={<RiAlertLine className="text-muted-foreground size-4" />}
              isLoading={statsLoading}
            />
            <StatCard
              title={m.network_avg_latency()}
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
          <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Game server hops */}
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

            {/* Other hops */}
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
      )}
    </div>
  )
}

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
                entry.isGameServer ? 'bg-amber-500' : 'bg-red-500',
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
    <ExpandableMap
      className="h-80"
      renderExpanded={() => <ServerMapContent entries={entries} />}
    >
      <ServerMapContent entries={entries} />
    </ExpandableMap>
  )
}

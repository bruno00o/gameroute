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
  RiMapPinLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { RecurringProblemHop, NetworkMapEntry } from '@/types/backend'
import {
  getNetworkOverviewStats,
  getNetworkMapData,
  getRecurringProblemHops,
} from '@/lib/tauri'
import { formatMs, formatLoss, latencyColor } from '@/lib/format'
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

export const Route = createFileRoute('/network')({
  component: NetworkPage,
})

const HOPS_PAGE_SIZE = 10
const SERVERS_PAGE_SIZE = 6

const hopColumnHelper = createColumnHelper<RecurringProblemHop>()

function NetworkPage() {
  const [gsServerPage, setGsServerPage] = useState(0)
  const [otherServerPage, setOtherServerPage] = useState(0)
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

  // Split data by game server flag
  const { gsServers, otherServers } = useMemo(() => {
    if (!mapData) return { gsServers: [], otherServers: [] }
    return {
      gsServers: mapData.filter(e => e.isGameServer),
      otherServers: mapData.filter(e => !e.isGameServer),
    }
  }, [mapData])

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
      hopColumnHelper.accessor('asn', {
        header: () => m.network_col_asn(),
        cell: info => info.getValue() ?? '-',
      }),
      hopColumnHelper.accessor('isp', {
        header: () => m.network_col_isp(),
        cell: info => info.getValue() ?? '-',
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

  const gsTotalPages = Math.max(1, Math.ceil(gsServers.length / SERVERS_PAGE_SIZE))
  const pagedGsServers = useMemo(() => {
    const start = gsServerPage * SERVERS_PAGE_SIZE
    return gsServers.slice(start, start + SERVERS_PAGE_SIZE)
  }, [gsServers, gsServerPage])

  const otherTotalPages = Math.max(1, Math.ceil(otherServers.length / SERVERS_PAGE_SIZE))
  const pagedOtherServers = useMemo(() => {
    const start = otherServerPage * SERVERS_PAGE_SIZE
    return otherServers.slice(start, start + SERVERS_PAGE_SIZE)
  }, [otherServers, otherServerPage])

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

          {/* Game Servers section */}
          <div className="mt-8">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <RiGamepadLine className="size-5 text-amber-500" />
              {m.network_game_servers_title()}
            </h2>

            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium">{m.network_game_server_hops_title()}</h3>
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
                <h3 className="text-sm font-medium">{m.network_map_title()}</h3>
                {mapLoading ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-28" />
                    ))}
                  </div>
                ) : gsServers.length === 0 ? (
                  <div className="mt-4 flex flex-col items-center gap-2 text-center">
                    <RiEarthLine className="text-muted-foreground size-6" />
                    <p className="text-muted-foreground text-xs">{m.network_map_empty()}</p>
                  </div>
                ) : (
                  <div className="mt-3">
                    <div className="grid grid-cols-2 gap-3">
                      {pagedGsServers.map(entry => (
                        <ServerCard key={entry.ip} entry={entry} />
                      ))}
                    </div>
                    {gsTotalPages > 1 && (
                      <PaginationControls
                        page={gsServerPage}
                        totalPages={gsTotalPages}
                        onPrev={() => setGsServerPage(p => p - 1)}
                        onNext={() => setGsServerPage(p => p + 1)}
                        canPrev={gsServerPage > 0}
                        canNext={gsServerPage < gsTotalPages - 1}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Other Servers section */}
          <div className="mt-8">
            <h2 className="text-lg font-semibold">{m.network_other_servers_title()}</h2>

            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium">{m.network_other_hops_title()}</h3>
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

              <div>
                <h3 className="text-sm font-medium">{m.network_map_title()}</h3>
                {mapLoading ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-28" />
                    ))}
                  </div>
                ) : otherServers.length === 0 ? (
                  <div className="mt-4 flex flex-col items-center gap-2 text-center">
                    <RiEarthLine className="text-muted-foreground size-6" />
                    <p className="text-muted-foreground text-xs">{m.network_map_empty()}</p>
                  </div>
                ) : (
                  <div className="mt-3">
                    <div className="grid grid-cols-2 gap-3">
                      {pagedOtherServers.map(entry => (
                        <ServerCard key={entry.ip} entry={entry} />
                      ))}
                    </div>
                    {otherTotalPages > 1 && (
                      <PaginationControls
                        page={otherServerPage}
                        totalPages={otherTotalPages}
                        onPrev={() => setOtherServerPage(p => p - 1)}
                        onNext={() => setOtherServerPage(p => p + 1)}
                        canPrev={otherServerPage > 0}
                        canNext={otherServerPage < otherTotalPages - 1}
                      />
                    )}
                  </div>
                )}
              </div>
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

function ServerCard({ entry }: { entry: NetworkMapEntry }) {
  const location = [entry.city, entry.country].filter(Boolean).join(', ')

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start gap-3">
          <RiMapPinLine className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-medium">{entry.ip}</p>
            {location && (
              <p className="text-muted-foreground truncate text-xs">{location}</p>
            )}
            {entry.isp && (
              <p className="text-muted-foreground truncate text-xs">{entry.isp}</p>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                {m.network_map_sessions({ count: String(entry.sessionCount) })}
              </span>
              {entry.asn && (
                <Badge variant="outline" className="text-xs">
                  {entry.asn}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

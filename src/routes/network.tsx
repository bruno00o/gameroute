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
  const [serverPage, setServerPage] = useState(0)
  const [hopSorting, setHopSorting] = useState<SortingState>([])

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

  const hopTable = useReactTable({
    data: problemHops ?? [],
    columns: hopColumns,
    state: { sorting: hopSorting },
    onSortingChange: setHopSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: HOPS_PAGE_SIZE } },
  })

  const serverTotalPages = mapData ? Math.max(1, Math.ceil(mapData.length / SERVERS_PAGE_SIZE)) : 1
  const pagedServers = useMemo(() => {
    if (!mapData) return []
    const start = serverPage * SERVERS_PAGE_SIZE
    return mapData.slice(start, start + SERVERS_PAGE_SIZE)
  }, [mapData, serverPage])

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

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold">{m.network_problem_hops_title()}</h2>
              {hopsLoading ? (
                <div className="mt-3">
                  <Skeleton className="h-40" />
                </div>
              ) : !problemHops || problemHops.length === 0 ? (
                <div className="mt-6 flex flex-col items-center gap-3 text-center">
                  <RiInboxLine className="text-muted-foreground size-8" />
                  <p className="text-muted-foreground text-sm">
                    {m.network_problem_hops_empty()}
                  </p>
                </div>
              ) : (
                <div className="mt-3">
                  <Table>
                    <TableHeader>
                      {hopTable.getHeaderGroups().map(headerGroup => (
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
                      {hopTable.getRowModel().rows.map(row => (
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
                  {hopTable.getPageCount() > 1 && (
                    <PaginationControls
                      page={hopTable.getState().pagination.pageIndex}
                      totalPages={hopTable.getPageCount()}
                      onPrev={() => hopTable.previousPage()}
                      onNext={() => hopTable.nextPage()}
                      canPrev={hopTable.getCanPreviousPage()}
                      canNext={hopTable.getCanNextPage()}
                    />
                  )}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-lg font-semibold">{m.network_map_title()}</h2>
              {mapLoading ? (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-28" />
                  ))}
                </div>
              ) : !mapData || mapData.length === 0 ? (
                <div className="mt-6 flex flex-col items-center gap-3 text-center">
                  <RiEarthLine className="text-muted-foreground size-8" />
                  <p className="text-muted-foreground text-sm">{m.network_map_empty()}</p>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="grid grid-cols-2 gap-3">
                    {pagedServers.map(entry => (
                      <ServerCard key={entry.ip} entry={entry} />
                    ))}
                  </div>
                  {serverTotalPages > 1 && (
                    <PaginationControls
                      page={serverPage}
                      totalPages={serverTotalPages}
                      onPrev={() => setServerPage(p => p - 1)}
                      onNext={() => setServerPage(p => p + 1)}
                      canPrev={serverPage > 0}
                      canNext={serverPage < serverTotalPages - 1}
                    />
                  )}
                </div>
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

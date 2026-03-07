import { useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { RiArrowLeftSLine, RiArrowRightSLine, RiInboxLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { SessionListItem } from '@/types/backend'
import { getSessions, getSessionCount } from '@/lib/tauri'
import { formatDate, formatDuration, computeDurationSecs } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/sessions/')({
  component: SessionsPage,
})

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<SessionListItem>()

function SessionsPage() {
  const [page, setPage] = useState(0)
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sessions', page],
    queryFn: async () => {
      const [items, count] = await Promise.all([
        getSessions(PAGE_SIZE, page * PAGE_SIZE),
        getSessionCount(),
      ])
      return { items, count }
    },
  })

  const sessions = data?.items ?? []
  const totalCount = data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const columns = useMemo(
    () => [
      columnHelper.accessor('gameName', {
        header: () => m.sessions_col_game(),
        cell: info => <span className="font-medium">{info.getValue()}</span>,
      }),
      columnHelper.accessor('endedAt', {
        id: 'status',
        header: () => m.sessions_col_status(),
        cell: info => {
          const isActive = info.getValue() === null
          return (
            <Badge variant={isActive ? 'default' : 'secondary'}>
              {isActive ? m.sessions_status_active() : m.sessions_status_completed()}
            </Badge>
          )
        },
      }),
      columnHelper.accessor('uniqueIpCount', {
        header: () => m.session_ips_count(),
        cell: info => <span className="tabular-nums">{info.getValue()}</span>,
      }),
      columnHelper.accessor('tracerouteCount', {
        header: () => m.session_traceroutes_count(),
        cell: info => <span className="tabular-nums">{info.getValue()}</span>,
      }),
      columnHelper.accessor('startedAt', {
        header: () => m.sessions_col_date(),
        cell: info => formatDate(info.getValue()),
      }),
      columnHelper.accessor(row => computeDurationSecs(row.startedAt, row.endedAt), {
        id: 'duration',
        header: () => m.session_duration(),
        cell: info => <span className="tabular-nums">{formatDuration(info.getValue())}</span>,
      }),
    ],
    []
  )

  const table = useReactTable({
    data: sessions,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_sessions_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_sessions_description()}</p>

      {isError && <div className="text-destructive mt-6 text-sm">{m.sessions_loading_error()}</div>}

      {isLoading ? (
        <SessionsTableSkeleton />
      ) : sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="mt-6">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map(headerGroup => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map(row => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    role="link"
                    onClick={() =>
                      navigate({
                        to: '/sessions/$id',
                        params: { id: String(row.original.id) },
                        search: { period: undefined },
                      })
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        navigate({
                          to: '/sessions/$id',
                          params: { id: String(row.original.id) },
                          search: { period: undefined },
                        })
                      }
                    }}
                  >
                    {row.getVisibleCells().map(cell => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {totalCount > PAGE_SIZE && (
            <Pagination
              page={page}
              totalPages={totalPages}
              totalCount={totalCount}
              onPrev={() => setPage(p => Math.max(0, p - 1))}
              onNext={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            />
          )}
        </>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <RiInboxLine className="text-muted-foreground size-10" />
      <h2 className="text-lg font-medium">{m.sessions_empty_title()}</h2>
      <p className="text-muted-foreground text-sm">{m.sessions_empty_description()}</p>
    </div>
  )
}

function SessionsTableSkeleton() {
  return (
    <div className="mt-6">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-8" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  totalCount,
  onPrev,
  onNext,
}: {
  page: number
  totalPages: number
  totalCount: number
  onPrev: () => void
  onNext: () => void
}) {
  const start = page * PAGE_SIZE + 1
  const end = Math.min((page + 1) * PAGE_SIZE, totalCount)

  return (
    <div className="mt-4 flex items-center justify-between">
      <span className="text-muted-foreground text-xs">
        {m.sessions_page_info({
          start: String(start),
          end: String(end),
          total: String(totalCount),
        })}
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={onPrev}>
          <RiArrowLeftSLine className="size-4" data-icon="inline-start" />
          {m.sessions_prev()}
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={onNext}>
          {m.sessions_next()}
          <RiArrowRightSLine className="size-4" data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

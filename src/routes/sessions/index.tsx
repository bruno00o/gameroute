import { useCallback, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { RiDownloadLine, RiLoader4Line, RiSearchLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { SessionListItem } from '@/types/backend'
import { getSessions, getSessionCount, searchSessions, searchSessionCount } from '@/lib/tauri'
import { exportSessionsList } from '@/lib/export-csv'
import { formatDate, formatDuration, formatNumber, computeDurationSecs } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'

export const Route = createFileRoute('/sessions/')({
  component: SessionsPage,
})

const PAGE_SIZE = 20

function SessionsPage() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const navigate = useNavigate()

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(0)
    clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])

  const query = debouncedSearch.trim()
  const isSearching = query.length > 0

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sessions', page, debouncedSearch],
    queryFn: async () => {
      const [items, count] = await Promise.all([
        query
          ? searchSessions(query, PAGE_SIZE, page * PAGE_SIZE)
          : getSessions(PAGE_SIZE, page * PAGE_SIZE),
        query ? searchSessionCount(query) : getSessionCount(),
      ])
      return { items, count }
    },
  })

  const sessions = data?.items ?? []
  const totalCount = data?.count ?? 0

  const columns = useMemo<DataTableColumn<SessionListItem>[]>(
    () => [
      {
        key: 'gameName',
        label: m.sessions_col_game(),
        render: session => <span className="font-medium">{session.gameName}</span>,
      },
      {
        key: 'status',
        label: m.sessions_col_status(),
        render: session =>
          session.endedAt === null ? (
            m.sessions_status_active()
          ) : (
            <span className="text-muted-foreground">{m.sessions_status_completed()}</span>
          ),
      },
      {
        key: 'uniqueIpCount',
        label: m.session_ips_count(),
        align: 'end',
        mono: true,
        render: session => formatNumber(session.uniqueIpCount),
      },
      {
        key: 'tracerouteCount',
        label: m.session_traceroutes_count(),
        align: 'end',
        mono: true,
        render: session => formatNumber(session.tracerouteCount),
      },
      {
        key: 'startedAt',
        label: m.sessions_col_date(),
        render: session => formatDate(session.startedAt),
      },
      {
        key: 'duration',
        label: m.session_duration(),
        align: 'end',
        mono: true,
        render: session => formatDuration(computeDurationSecs(session.startedAt, session.endedAt)),
      },
    ],
    []
  )

  const hasData = !isLoading && (sessions.length > 0 || isSearching)

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{m.page_sessions_title()}</h1>
          <p className="text-muted-foreground mt-2">{m.page_sessions_description()}</p>
        </div>
        {hasData && (
          <Button
            size="sm"
            loading={isExporting}
            onClick={async () => {
              setIsExporting(true)
              try {
                const all = query
                  ? await searchSessions(query, 10000, 0)
                  : await getSessions(10000, 0)
                exportSessionsList(all)
              } finally {
                setIsExporting(false)
              }
            }}
          >
            {isExporting ? (
              <RiLoader4Line className="animate-spin" data-icon="inline-start" />
            ) : (
              <RiDownloadLine data-icon="inline-start" />
            )}
            {m.export_csv_button()}
          </Button>
        )}
      </div>

      {hasData && (
        <TextField
          className="mt-4"
          prefix={<RiSearchLine />}
          aria-label={m.sessions_search_placeholder()}
          placeholder={m.sessions_search_placeholder()}
          value={search}
          onChange={e => handleSearchChange(e.target.value)}
        />
      )}

      {isError ? (
        <div className="text-destructive mt-6 text-sm">{m.sessions_loading_error()}</div>
      ) : (
        <DataTable
          className="mt-4"
          columns={columns}
          rows={sessions}
          loading={isLoading}
          pagination={{
            pageIndex: page,
            pageSize: PAGE_SIZE,
            rowCount: totalCount,
            onPageChange: setPage,
          }}
          onRowClick={session =>
            navigate({
              to: '/sessions/$id',
              params: { id: String(session.id) },
              search: { period: undefined },
            })
          }
          empty={
            isSearching ? (
              <EmptyState title={m.search_no_match({ query })} />
            ) : (
              <EmptyState title={m.sessions_empty_title()}>
                {m.sessions_empty_description()}
              </EmptyState>
            )
          }
        />
      )}
    </div>
  )
}

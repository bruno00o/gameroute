import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { RiCloseLine, RiDownloadLine, RiLoopLeftLine, RiSearchLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { SessionGame, SessionListFilter, SessionListItem } from '@/types/backend'
import { getSessionList, openLogDir } from '@/lib/tauri'
import { exportSessionsList } from '@/lib/export-csv'
import { formatDay, formatNumber } from '@/lib/format'
import { counted } from '@/lib/route-history'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { TextField } from '@/components/ui/text-field'
import { DataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { GameSelect } from '@/components/game-select'
import { Notice } from '@/components/notice'
import { sessionColumns } from '@/components/session/session-columns'

export const Route = createFileRoute('/sessions/')({
  component: SessionsPage,
})

const PAGE_SIZE = 20
const EXPORT_PAGE_SIZE = 100
const SEARCH_DELAY_MS = 300

type Quality = 'all' | 'review'

function SessionsPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [game, setGame] = useState<string | null>(null)
  const [quality, setQuality] = useState<Quality>('all')
  const [isExporting, setIsExporting] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(searchTimer.current), [])

  const filter = useMemo<SessionListFilter>(
    () => ({ search: query || undefined, game: game ?? undefined, toReview: quality === 'review' }),
    [query, game, quality]
  )

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ['sessions', 'list', filter, page],
    queryFn: () => getSessionList(filter, PAGE_SIZE, page * PAGE_SIZE),
    placeholderData: keepPreviousData,
  })

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(0)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setQuery(value.trim()), SEARCH_DELAY_MS)
  }, [])

  const clearSearch = () => {
    clearTimeout(searchTimer.current)
    setSearch('')
    setQuery('')
    setPage(0)
  }

  const showAll = () => {
    clearSearch()
    setGame(null)
    setQuality('all')
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const sessions: SessionListItem[] = []
      for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
        const chunk = await getSessionList(filter, EXPORT_PAGE_SIZE, offset)
        sessions.push(...chunk.items)
        if (chunk.items.length < EXPORT_PAGE_SIZE || sessions.length >= chunk.total) break
      }
      await exportSessionsList(sessions)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setIsExporting(false)
    }
  }

  const columns = useMemo(() => sessionColumns(), [])

  const hasSessions = (data?.recorded ?? 0) > 0
  const sessions = data?.items ?? []
  const summary =
    data?.firstStartedAt && hasSessions
      ? (data.recorded === 1 ? m.sessions_summary_one : m.sessions_summary_other)({
          count: formatNumber(data.recorded),
          date: formatDay(data.firstStartedAt),
        })
      : null

  const empty = !hasSessions ? (
    <EmptyState
      title={m.sessions_empty_title()}
      action={
        <Button size="sm" onClick={() => navigate({ to: '/games' })}>
          {m.sessions_empty_action()}
        </Button>
      }
    >
      {m.sessions_empty_description()}
    </EmptyState>
  ) : query ? (
    <EmptyState
      title={m.sessions_search_empty_title({ query })}
      action={
        <Button size="sm" variant="ghost" onClick={clearSearch}>
          <RiCloseLine data-icon="inline-start" />
          {m.sessions_search_clear()}
        </Button>
      }
    >
      {m.sessions_search_empty_hint()}
    </EmptyState>
  ) : (
    <EmptyState
      title={
        quality === 'review'
          ? m.sessions_review_empty_title()
          : m.sessions_search_empty_title({ query: game ?? '' })
      }
      action={
        <Button size="sm" variant="ghost" onClick={showAll}>
          {m.sessions_show_all()}
        </Button>
      }
    >
      {quality === 'review' && m.sessions_review_empty_hint()}
    </EmptyState>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4 px-6 pt-5 pb-6">
        <header className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-0.5">
            <h1 className="text-title">{m.page_sessions_title()}</h1>
            {summary && (
              <p className="text-data-sm text-muted-foreground font-mono tabular-nums">{summary}</p>
            )}
          </div>
          {hasSessions && (data?.total ?? 0) > 0 && (
            <Button variant="ghost" size="sm" loading={isExporting} onClick={handleExport}>
              <RiDownloadLine data-icon="inline-start" />
              {m.export_csv_button()}
            </Button>
          )}
        </header>

        {hasSessions && (
          <div className="flex flex-wrap items-center gap-3">
            <TextField
              className="max-w-[380px] flex-[1_1_280px]"
              prefix={<RiSearchLine />}
              aria-label={m.sessions_search_label()}
              placeholder={m.sessions_search_placeholder()}
              value={search}
              onChange={event => handleSearchChange(event.target.value)}
            />
            <GameFilter
              games={data?.games ?? []}
              value={game}
              onChange={next => {
                setGame(next)
                setPage(0)
              }}
            />
            <Segmented<Quality>
              label={m.sessions_filter_quality()}
              value={quality}
              onValueChange={next => {
                setQuality(next)
                setPage(0)
              }}
              options={[
                { value: 'all', label: m.sessions_filter_quality_all() },
                { value: 'review', label: m.sessions_filter_quality_review() },
              ]}
            />
          </div>
        )}

        {isError ? (
          <Notice
            tone="critical"
            title={m.sessions_error_title()}
            action={
              <>
                <Button size="sm" loading={isFetching} onClick={() => refetch()}>
                  <RiLoopLeftLine data-icon="inline-start" />
                  {m.sessions_error_retry()}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openLogDir().catch(err => toast.error(errorMessage(err)))}
                >
                  {m.sessions_error_logs()}
                </Button>
              </>
            }
          >
            {m.sessions_error_body()}
          </Notice>
        ) : (
          <DataTable
            columns={columns}
            rows={sessions}
            loading={isPending}
            pagination={{
              pageIndex: page,
              pageSize: PAGE_SIZE,
              rowCount: data?.total ?? 0,
              onPageChange: setPage,
            }}
            onRowClick={session =>
              navigate({
                to: '/sessions/$id',
                params: { id: String(session.id) },
                search: { period: undefined },
              })
            }
            empty={empty}
          />
        )}

        {!isError && sessions.some(session => session.endEstimated) && (
          <p className="text-label text-ink-subtle max-w-[72ch] font-normal">
            {m.sessions_estimated_note()}
          </p>
        )}
      </div>
    </div>
  )
}

function GameFilter({
  games,
  value,
  onChange,
}: {
  games: SessionGame[]
  value: string | null
  onChange: (game: string | null) => void
}) {
  if (games.length < 2) return null

  return (
    <GameSelect
      allowAll
      games={games.map(game => ({ name: game.name, count: game.sessionCount }))}
      value={value}
      onValueChange={onChange}
      countLabel={count => counted(count, m.game_select_sessions_one, m.game_select_sessions_other)}
    />
  )
}

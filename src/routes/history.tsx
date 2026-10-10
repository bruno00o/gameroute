import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import { getServerSummary, getSeverityThresholds, getWeekHourGrid } from '@/lib/tauri'
import { formatDay } from '@/lib/format'
import { counted } from '@/lib/route-history'
import {
  DEFAULT_HISTORY_DAYS,
  HISTORY_DAYS,
  gridFacts,
  gridTitle,
  isHistoryDays,
} from '@/lib/week-hour'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { GameSelect } from '@/components/game-select'
import { LoadError } from '@/components/load-error'
import { Panel } from '@/components/panel'
import { ServerTable } from '@/components/home/server-table'
import { WeekHourGridView } from '@/components/history/week-hour-grid'
import { SessionHeader } from '@/components/session/session-screen'

type HistorySearch = { game?: string; days?: number }

export const Route = createFileRoute('/history')({
  component: HistoryPage,
  validateSearch: (search: Record<string, unknown>): HistorySearch => {
    const days = Number(search.days)
    return {
      game: typeof search.game === 'string' && search.game ? search.game : undefined,
      days: isHistoryDays(days) && days !== DEFAULT_HISTORY_DAYS ? days : undefined,
    }
  },
})

const rangeLabels: Record<(typeof HISTORY_DAYS)[number], () => string> = {
  30: m.history_range_30,
  90: m.history_range_90,
  365: m.history_range_365,
}

function HistoryPage() {
  const { game, days: searchDays } = Route.useSearch()
  const days = searchDays ?? DEFAULT_HISTORY_DAYS
  const navigate = useNavigate()

  const gridQuery = useQuery({
    queryKey: ['history', 'week-hour-grid', days],
    queryFn: () => getWeekHourGrid(days),
  })
  const summaryQuery = useQuery({
    queryKey: ['sessions', 'server-summary', days],
    queryFn: () => getServerSummary(days),
  })
  const { data: thresholds } = useQuery({
    queryKey: ['severity-thresholds'],
    queryFn: getSeverityThresholds,
    staleTime: Infinity,
  })

  const grid = gridQuery.data
  const current = grid?.games.find(item => item.gameName === game) ?? grid?.games[0]
  const servers = useMemo(
    () =>
      (summaryQuery.data?.servers ?? []).filter(server => server.gameName === current?.gameName),
    [summaryQuery.data, current?.gameName]
  )
  const facts = current ? gridFacts(current) : null

  const search = (next: HistorySearch): HistorySearch => ({
    game: next.game,
    days: next.days === DEFAULT_HISTORY_DAYS ? undefined : next.days,
  })

  const actions = (
    <>
      {grid && grid.games.length > 1 && current && (
        <GameSelect
          games={grid.games.map(item => ({ name: item.gameName, count: item.matchCount }))}
          value={current.gameName}
          countLabel={count =>
            counted(count, m.session_matches_count_one, m.session_matches_count_other)
          }
          onValueChange={value =>
            value &&
            navigate({ to: '/history', search: search({ game: value, days }), replace: true })
          }
        />
      )}
      <Segmented
        label={m.history_range_label()}
        options={HISTORY_DAYS.map(value => ({ value: String(value), label: rangeLabels[value]() }))}
        value={String(days)}
        onValueChange={value =>
          navigate({
            to: '/history',
            search: search({ game: current?.gameName, days: Number(value) }),
            replace: true,
          })
        }
      />
    </>
  )

  const headerFacts = current
    ? [
        counted(current.matchCount, m.session_matches_count_one, m.session_matches_count_other),
        m.history_range_dates({
          from: formatDay(current.firstPlayedAt),
          to: formatDay(current.lastPlayedAt),
        }),
      ]
    : []

  return (
    <div className="h-full overflow-y-auto">
      <SessionHeader title={m.nav_history()} facts={headerFacts} actions={actions} />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        {gridQuery.isError ? (
          <LoadError
            title={m.history_error_title()}
            retrying={gridQuery.isFetching}
            onRetry={() => {
              gridQuery.refetch()
              summaryQuery.refetch()
            }}
          />
        ) : !grid || !thresholds ? (
          <Skeleton className="h-64 w-full" />
        ) : !current || !facts ? (
          <Panel>
            <EmptyState title={m.history_empty_title({ days: String(days) })}>
              {m.history_empty_body()}
            </EmptyState>
          </Panel>
        ) : (
          <>
            <Panel
              label={m.history_label()}
              title={gridTitle(current, thresholds, grid.usualMinSamples)}
            >
              <WeekHourGridView game={current} thresholds={thresholds} />
              <div className="text-label text-muted-foreground mt-4 flex max-w-[80ch] flex-col gap-1 font-normal">
                <p>{m.history_note()}</p>
                {facts.hasAtLeast && <p>{m.history_note_at_least()}</p>}
                {facts.hasGame && <p>{m.history_note_game()}</p>}
                {facts.hasUnknown && (
                  <p>{m.history_note_unknown({ min: String(grid.usualMinSamples) })}</p>
                )}
              </div>
            </Panel>

            <Panel
              label={m.home_servers_label()}
              flush
              footer={
                summaryQuery.data &&
                servers.length > 0 &&
                m.home_servers_note({
                  days: String(days),
                  recent: String(summaryQuery.data.recentDays),
                  max: String(summaryQuery.data.usualMaxSamples),
                  min: String(summaryQuery.data.usualMinSamples),
                })
              }
            >
              <ServerTable
                servers={servers}
                days={days}
                usualMinSamples={summaryQuery.data?.usualMinSamples ?? 0}
                recentDays={summaryQuery.data?.recentDays}
                loading={summaryQuery.isLoading}
                showGame={false}
              />
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}

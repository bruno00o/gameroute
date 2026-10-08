import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { RiArrowRightSLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { ServerSummary, SessionListPage } from '@/types/backend'
import { getServerSummary, getSessionList } from '@/lib/tauri'
import { formatDay, formatNumber } from '@/lib/format'
import { homeVerdict } from '@/lib/server-summary'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { LoadError } from '@/components/load-error'
import { FirstLaunch } from '@/components/home/first-launch'
import { ServerTable } from '@/components/home/server-table'
import { sessionColumns } from '@/components/session/session-columns'
import { Verdict } from '@/components/session/verdict'

export const Route = createFileRoute('/')({
  component: HomePage,
})

const DAYS = 7
const RECENT_SESSIONS = 5

function HomePage() {
  const summaryQuery = useQuery({
    queryKey: ['sessions', 'server-summary', DAYS],
    queryFn: () => getServerSummary(DAYS),
  })
  const recentQuery = useQuery({
    queryKey: ['sessions', 'recent', RECENT_SESSIONS],
    queryFn: () => getSessionList({}, RECENT_SESSIONS, 0),
  })

  const summary = summaryQuery.data
  const recent = recentQuery.data
  const failed = summaryQuery.isError || recentQuery.isError
  const fresh = summary?.servers.length === 0 && recent?.recorded === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-4 px-6 pt-5 pb-6">
        <h1 className="text-title">{m.page_dashboard_title()}</h1>
        {failed ? (
          <LoadError
            title={m.sessions_error_title()}
            retrying={summaryQuery.isFetching || recentQuery.isFetching}
            onRetry={() => {
              summaryQuery.refetch()
              recentQuery.refetch()
            }}
          />
        ) : fresh ? (
          <FirstLaunch />
        ) : (
          <Overview summary={summary} recent={recent} />
        )}
      </div>
    </div>
  )
}

function Overview({ summary, recent }: { summary?: ServerSummary; recent?: SessionListPage }) {
  const navigate = useNavigate()
  const verdict = useMemo(() => summary && homeVerdict(summary.servers, DAYS), [summary])
  const columns = useMemo(() => sessionColumns({ sortable: false }), [])
  const lastServer = summary?.servers[0]

  return (
    <>
      {!summary ? (
        <Skeleton className="h-28 w-full" />
      ) : verdict ? (
        <Verdict status={verdict.status} title={verdict.title} scope={verdict.scope}>
          {verdict.sentences.length > 0 ? verdict.sentences.join(' ') : null}
        </Verdict>
      ) : (
        lastServer && (
          <Panel>
            <EmptyState title={m.home_idle_title({ count: String(DAYS) })}>
              {m.home_idle_body({
                date: formatDay(lastServer.lastPlayedAt),
                game: lastServer.gameName,
              })}
            </EmptyState>
          </Panel>
        )
      )}

      <Panel
        label={m.home_servers_label()}
        flush={summary?.servers.length !== 0}
        footer={
          summary &&
          summary.servers.length > 0 &&
          m.home_servers_note({
            days: String(DAYS),
            max: String(summary.usualMaxSamples),
            min: String(summary.usualMinSamples),
          })
        }
      >
        {summary?.servers.length === 0 ? (
          <EmptyState compact title={m.home_servers_empty_title()}>
            {m.home_servers_empty_body()}
          </EmptyState>
        ) : (
          <ServerTable
            servers={summary?.servers ?? []}
            days={DAYS}
            usualMinSamples={summary?.usualMinSamples ?? 0}
            loading={!summary}
          />
        )}
      </Panel>

      <Panel
        label={m.home_recent_label()}
        flush
        action={
          recent &&
          recent.recorded > RECENT_SESSIONS && (
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/sessions' })}>
              {m.home_recent_all({ count: formatNumber(recent.recorded) })}
              <RiArrowRightSLine data-icon="inline-end" />
            </Button>
          )
        }
      >
        <DataTable
          columns={columns}
          rows={recent?.items ?? []}
          loading={!recent}
          onRowClick={session =>
            navigate({
              to: '/sessions/$id',
              params: { id: String(session.id) },
              search: { period: undefined },
            })
          }
          empty={
            <EmptyState compact title={m.sessions_empty_title()}>
              {m.sessions_empty_description()}
            </EmptyState>
          }
        />
      </Panel>
    </>
  )
}

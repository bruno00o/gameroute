import { useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { RiArrowRightSLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { RecentSession } from '@/types/backend'
import { useSettingsStore } from '@/stores/settings-store'
import { getDashboardData, getNetworkOverviewStats } from '@/lib/tauri'
import { formatDuration, formatDate, formatMs, computeDurationSecs } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { Fact, FactRow } from '@/components/fact-row'
import { Panel } from '@/components/panel'
import { StatusPill } from '@/components/status/status-pill'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const advancedMode = useSettingsStore(s => s.advancedMode)
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboardData,
  })

  const { data: networkStats, isLoading: networkLoading } = useQuery({
    queryKey: ['network-overview-stats'],
    queryFn: getNetworkOverviewStats,
  })

  const recentColumns = useMemo<DataTableColumn<RecentSession>[]>(
    () => [
      {
        key: 'gameName',
        label: m.dashboard_col_game(),
        sortable: false,
        render: session => <span className="font-medium">{session.gameName}</span>,
      },
      {
        key: 'duration',
        label: m.dashboard_col_duration(),
        sortable: false,
        align: 'end',
        mono: true,
        render: session => formatDuration(computeDurationSecs(session.startedAt, session.endedAt)),
      },
      {
        key: 'startedAt',
        label: m.dashboard_col_date(),
        sortable: false,
        render: session => formatDate(session.startedAt),
      },
    ],
    []
  )

  const statValue = (value: string | number | undefined) =>
    isLoading ? <Skeleton className="h-5 w-16" /> : value

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_dashboard_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_dashboard_description()}</p>

      <FactRow className="mt-6">
        <Fact label={m.dashboard_total_sessions()}>{statValue(data?.totalSessions)}</Fact>
        <Fact label={m.dashboard_total_play_time()}>
          {statValue(data ? formatDuration(data.totalPlayTimeSecs) : undefined)}
        </Fact>
        <Fact label={m.dashboard_unique_games()}>{statValue(data?.uniqueGames)}</Fact>
      </FactRow>

      <div className="mt-6 flex flex-col gap-6">
        <Panel
          label={m.dashboard_network_title()}
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/network' })}>
              {m.dashboard_network_details()}
              <RiArrowRightSLine data-icon="inline-end" />
            </Button>
          }
        >
          {networkLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
              <StatusPill status={networkStats?.status ?? 'unmeasured'} />
              {networkStats && networkStats.totalTraceroutes > 0 && (
                <FactRow>
                  <Fact
                    label={advancedMode ? m.dashboard_avg_latency() : m.simple_avg_latency()}
                    hint={
                      advancedMode
                        ? m.dashboard_avg_latency_tooltip()
                        : m.simple_dashboard_avg_latency_tooltip()
                    }
                  >
                    {formatMs(networkStats.avgLatency)}
                  </Fact>
                  <Fact
                    label={advancedMode ? m.dashboard_problem_hops() : m.simple_problem_hops()}
                    hint={
                      advancedMode
                        ? m.dashboard_problem_hops_tooltip()
                        : m.simple_dashboard_problem_hops_tooltip()
                    }
                  >
                    {networkStats.totalProblemHops}
                  </Fact>
                </FactRow>
              )}
            </div>
          )}
        </Panel>

        <Panel
          label={m.dashboard_recent_activity()}
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/sessions' })}>
              {m.dashboard_view_all()}
              <RiArrowRightSLine data-icon="inline-end" />
            </Button>
          }
          flush
        >
          <DataTable
            columns={recentColumns}
            rows={data?.recentSessions ?? []}
            loading={isLoading}
            onRowClick={session =>
              navigate({
                to: '/sessions/$id',
                params: { id: String(session.id) },
                search: { period: undefined },
              })
            }
            empty={
              <EmptyState title={m.sessions_empty_title()}>
                {m.sessions_empty_description()}
              </EmptyState>
            }
          />
        </Panel>
      </div>
    </div>
  )
}

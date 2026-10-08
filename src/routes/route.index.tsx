import { useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiMore2Fill } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import {
  getNetworkOverviewStats,
  getRecurringProblemHops,
  getRouteChanges,
  getServerStability,
  getServerSummary,
  getUsualRoute,
} from '@/lib/tauri'
import { exportServerStability } from '@/lib/export-csv'
import { generateNetworkExport } from '@/lib/export-llm'
import { counted, destinationName, ROUTE_DAYS, routeLimitNote } from '@/lib/route-history'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { LoadError } from '@/components/load-error'
import { Panel } from '@/components/panel'
import { ServerTable } from '@/components/home/server-table'
import { OperatorContributions } from '@/components/route/operator-contributions'
import { RouteChanges } from '@/components/route/route-changes'
import { RouteStrip } from '@/components/route/route-strip'
import { UsualRouteMap } from '@/components/route/usual-route-map'
import { SessionHeader } from '@/components/session/session-screen'

type RouteSearch = { game?: string; operator?: string }

export const Route = createFileRoute('/route/')({
  component: RoutePage,
  validateSearch: (search: Record<string, unknown>): RouteSearch => {
    const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
    return { game: text(search.game), operator: text(search.operator) }
  },
})

function RoutePage() {
  const { game, operator } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const usualQuery = useQuery({
    queryKey: ['sessions', 'usual-route', ROUTE_DAYS],
    queryFn: () => getUsualRoute(ROUTE_DAYS),
  })
  const changesQuery = useQuery({
    queryKey: ['sessions', 'route-changes', ROUTE_DAYS],
    queryFn: () => getRouteChanges(ROUTE_DAYS),
  })
  const summaryQuery = useQuery({
    queryKey: ['sessions', 'server-summary', ROUTE_DAYS],
    queryFn: () => getServerSummary(ROUTE_DAYS),
  })

  const routes = usualQuery.data
  const usual = routes?.find(route => route.gameName === game) ?? routes?.[0]
  const changes = useMemo(
    () => (changesQuery.data ?? []).filter(change => change.gameName === usual?.gameName),
    [changesQuery.data, usual?.gameName]
  )
  const servers = useMemo(
    () => (summaryQuery.data?.servers ?? []).filter(server => server.gameName === usual?.gameName),
    [summaryQuery.data, usual?.gameName]
  )

  const copyForAi = async () => {
    try {
      const [stats, problemHops, stability] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: ['network-overview-stats'],
          queryFn: getNetworkOverviewStats,
        }),
        queryClient.fetchQuery({
          queryKey: ['network-problem-hops'],
          queryFn: getRecurringProblemHops,
        }),
        queryClient.fetchQuery({ queryKey: ['insights-stability'], queryFn: getServerStability }),
      ])
      await navigator.clipboard.writeText(generateNetworkExport(stats, problemHops, stability))
      toast.success(m.export_llm_copied())
    } catch {
      toast.error(m.export_llm_error())
    }
  }

  const exportCsv = async () => {
    try {
      exportServerStability(
        await queryClient.fetchQuery({
          queryKey: ['insights-stability'],
          queryFn: getServerStability,
        })
      )
    } catch {
      toast.error(m.export_csv_error())
    }
  }

  const actions = (
    <>
      <Link to="/trace" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        {m.route_page_traces()}
      </Link>
      {routes && routes.length > 1 && usual && (
        <Segmented
          label={m.route_page_game()}
          options={routes.map(route => ({ value: route.gameName, label: route.gameName }))}
          value={usual.gameName}
          onValueChange={value =>
            navigate({ to: '/route', search: { game: value, operator: undefined }, replace: true })
          }
        />
      )}
      {usual && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={m.session_more_actions()} />}
          >
            <RiMore2Fill />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-48">
            <DropdownMenuItem onClick={copyForAi}>{m.export_llm_button()}</DropdownMenuItem>
            <DropdownMenuItem onClick={exportCsv}>{m.export_csv_button()}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )

  return (
    <div className="h-full overflow-y-auto">
      <SessionHeader
        title={m.nav_route()}
        facts={[m.route_page_subtitle({ days: String(ROUTE_DAYS) })]}
        actions={actions}
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        {usualQuery.isError ? (
          <LoadError
            title={m.route_error_title()}
            retrying={usualQuery.isFetching}
            onRetry={() => {
              usualQuery.refetch()
              changesQuery.refetch()
              summaryQuery.refetch()
            }}
          />
        ) : !routes ? (
          <Skeleton className="h-40 w-full" />
        ) : !usual ? (
          <Panel>
            <EmptyState title={m.route_empty_title()}>{m.route_empty_body()}</EmptyState>
          </Panel>
        ) : (
          <>
            <Panel
              label={m.route_usual_label()}
              title={m.route_usual_matches({
                count: String(usual.traceCount),
                total: String(usual.totalTraces),
              })}
            >
              <RouteStrip
                route={usual.route}
                destination={{ name: destinationName(usual) }}
                persistentLoss={usual.persistentLoss}
              />
              {usual.route.destinationSilent && (
                <p className="text-ui text-muted-foreground mt-4 max-w-[70ch]">
                  {routeLimitNote(usual)}
                </p>
              )}
            </Panel>

            <Panel
              label={m.route_contrib_label()}
              title={m.route_contrib_title({
                matches: counted(
                  usual.traceCount,
                  m.session_matches_count_one,
                  m.session_matches_count_other
                ),
              })}
            >
              <OperatorContributions usual={usual} highlight={operator} />
            </Panel>

            <Panel
              label={m.route_changes_label()}
              title={
                changes.length > 0
                  ? m.route_changes_title({
                      changes: counted(
                        changes.length,
                        m.route_changes_count_one,
                        m.route_changes_count_other
                      ),
                      days: String(ROUTE_DAYS),
                    })
                  : undefined
              }
            >
              {changesQuery.isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : changes.length > 0 ? (
                <RouteChanges changes={changes} usual={usual} />
              ) : (
                <EmptyState compact title={m.route_changes_none_title()}>
                  {m.route_changes_none_body({ days: String(ROUTE_DAYS) })}
                </EmptyState>
              )}
            </Panel>

            <Panel
              label={m.home_servers_label()}
              flush
              footer={
                summaryQuery.data &&
                servers.length > 0 &&
                m.home_servers_note({
                  days: String(ROUTE_DAYS),
                  max: String(summaryQuery.data.usualMaxSamples),
                  min: String(summaryQuery.data.usualMinSamples),
                })
              }
            >
              <ServerTable
                servers={servers}
                days={ROUTE_DAYS}
                usualMinSamples={summaryQuery.data?.usualMinSamples ?? 0}
                loading={summaryQuery.isLoading}
                showGame={false}
              />
            </Panel>

            <UsualRouteMap key={usual.gameName} usual={usual} />
          </>
        )}
      </div>
    </div>
  )
}

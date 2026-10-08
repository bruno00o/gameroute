import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  RiArrowRightSLine,
  RiGamepadLine,
  RiInboxLine,
  RiTimeLine,
  RiPulseLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { useSettingsStore } from '@/stores/settings-store'
import { getDashboardData, getNetworkOverviewStats } from '@/lib/tauri'
import { formatDuration, formatDate, formatMs, latencyColor, computeDurationSecs } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function getNetworkVerdict(
  avgLatency: number | null,
  uniqueProblemHops: number,
  totalTraceroutes: number,
) {
  if (totalTraceroutes === 0) return 'no-data'
  // uniqueProblemHops = count of distinct router IPs flagged as problems
  if ((avgLatency != null && avgLatency >= 80) || uniqueProblemHops >= 5) return 'poor'
  if ((avgLatency != null && avgLatency >= 50) || uniqueProblemHops >= 2) return 'fair'
  return 'good'
}

const verdictConfig = {
  good: {
    label: () => m.dashboard_network_good(),
    desc: () => m.dashboard_network_good_desc(),
    color: 'text-ok',
    bg: 'border-border bg-card',
  },
  fair: {
    label: () => m.dashboard_network_fair(),
    desc: () => m.dashboard_network_fair_desc(),
    color: 'text-watch',
    bg: 'bg-watch-soft border-watch/30',
  },
  poor: {
    label: () => m.dashboard_network_poor(),
    desc: () => m.dashboard_network_poor_desc(),
    color: 'text-destructive',
    bg: 'bg-critical-soft border-destructive/30',
  },
  'no-data': {
    label: () => m.dashboard_network_no_data(),
    desc: () => '',
    color: 'text-muted-foreground',
    bg: 'border-border bg-card',
  },
} as const

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

  const verdict = networkStats
    ? getNetworkVerdict(networkStats.avgLatency, networkStats.totalProblemHops, networkStats.totalTraceroutes)
    : 'no-data'
  const vc = verdictConfig[verdict]

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_dashboard_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_dashboard_description()}</p>

      {/* Network health verdict — click for details */}
      <div
        className={`mt-6 flex cursor-pointer items-center gap-4 rounded-lg border p-4 transition-opacity hover:opacity-80 ${vc.bg}`}
        role="link"
        aria-label={m.dashboard_network_title()}
        tabIndex={0}
        onClick={() => navigate({ to: '/network' })}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            navigate({ to: '/network' })
          }
        }}
      >
        {networkLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <>
            <RiPulseLine className={`size-8 shrink-0 ${vc.color}`} />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold ${vc.color}`}>{vc.label()}</span>
                <span className="text-muted-foreground text-sm">
                  {m.dashboard_network_title()}
                </span>
              </div>
              {verdict !== 'no-data' && (
                <p className="text-muted-foreground text-sm">{vc.desc()}</p>
              )}
              <p className="text-muted-foreground/60 text-xs">{m.dashboard_network_details()}</p>
            </div>
            {verdict !== 'no-data' && networkStats && (
              <div className="flex shrink-0 gap-6 text-sm">
                <Tooltip>
                  <TooltipTrigger render={<div className="text-center cursor-help" />}>
                      <div className={`text-lg font-bold ${latencyColor(networkStats.avgLatency)}`}>
                        {formatMs(networkStats.avgLatency)} ms
                      </div>
                      <div className="text-muted-foreground text-xs underline decoration-dotted">
                        {advancedMode ? m.dashboard_avg_latency() : m.simple_avg_latency()}
                      </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {advancedMode ? m.dashboard_avg_latency_tooltip() : m.simple_dashboard_avg_latency_tooltip()}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<div className="text-center cursor-help" />}>
                      <div className={`text-lg font-bold ${networkStats.totalProblemHops > 0 ? 'text-watch' : 'text-ok'}`}>
                        {networkStats.totalProblemHops}
                      </div>
                      <div className="text-muted-foreground text-xs underline decoration-dotted">
                        {advancedMode ? m.dashboard_problem_hops() : m.simple_problem_hops()}
                      </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    {advancedMode ? m.dashboard_problem_hops_tooltip() : m.simple_dashboard_problem_hops_tooltip()}
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
            <RiArrowRightSLine className="text-muted-foreground size-5 shrink-0" />
          </>
        )}
      </div>

      {/* Gaming stats */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <StatCard
          title={m.dashboard_total_sessions()}
          value={data?.totalSessions}
          icon={<RiInboxLine className="text-muted-foreground size-4" />}
          isLoading={isLoading}
        />
        <StatCard
          title={m.dashboard_total_play_time()}
          value={data ? formatDuration(data.totalPlayTimeSecs) : undefined}
          icon={<RiTimeLine className="text-muted-foreground size-4" />}
          isLoading={isLoading}
        />
        <StatCard
          title={m.dashboard_unique_games()}
          value={data?.uniqueGames}
          icon={<RiGamepadLine className="text-muted-foreground size-4" />}
          isLoading={isLoading}
        />
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{m.dashboard_recent_activity()}</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/sessions' })}
          >
            {m.dashboard_view_all()}
            <RiArrowRightSLine className="size-4" data-icon="inline-end" />
          </Button>
        </div>

        {isLoading ? (
          <RecentSessionsSkeleton />
        ) : !data || data.recentSessions.length === 0 ? (
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <RiInboxLine className="text-muted-foreground size-10" />
            <p className="text-muted-foreground text-sm">{m.dashboard_no_sessions()}</p>
          </div>
        ) : (
          <div className="mt-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{m.dashboard_col_game()}</TableHead>
                  <TableHead>{m.dashboard_col_duration()}</TableHead>
                  <TableHead>{m.dashboard_col_date()}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentSessions.map(session => (
                  <TableRow
                    key={session.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    role="link"
                    aria-label={session.gameName}
                    onClick={() => navigate({ to: '/sessions/$id', params: { id: String(session.id) }, search: { period: undefined } })}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        navigate({ to: '/sessions/$id', params: { id: String(session.id) }, search: { period: undefined } })
                      }
                    }}
                  >
                    <TableCell>
                      <span className="font-medium">{session.gameName}</span>
                    </TableCell>
                    <TableCell>
                      {formatDuration(computeDurationSecs(session.startedAt, session.endedAt))}
                    </TableCell>
                    <TableCell>{formatDate(session.startedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
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

function RecentSessionsSkeleton() {
  return (
    <div className="mt-3">
      <Table>
        <TableHeader>
          <TableRow>
            {Array.from({ length: 3 }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-14" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

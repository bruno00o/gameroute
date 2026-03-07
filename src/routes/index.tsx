import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  RiArrowRightSLine,
  RiGamepadLine,
  RiInboxLine,
  RiTimeLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { getDashboardData } from '@/lib/tauri'
import { formatDuration, formatDate, computeDurationSecs } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

function DashboardPage() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboardData,
  })

  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_dashboard_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_dashboard_description()}</p>

      <div className="mt-6 grid grid-cols-3 gap-4">
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

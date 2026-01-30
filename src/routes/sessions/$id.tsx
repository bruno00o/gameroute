import * as React from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  RiArrowLeftLine,
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiDashboardLine,
  RiErrorWarningLine,
  RiMapPinLine,
  RiServerLine,
  RiTimeLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { getSession, formatDate, formatDuration } from '@/lib/mock-sessions'
import type { Session, SessionHop } from '@/lib/mock-sessions'
import { useBreadcrumbStore, type BreadcrumbSegment } from '@/stores/breadcrumb-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/sessions/$id')({
  component: SessionDetailPage,
  validateSearch: (search: Record<string, unknown>) => {
    const hop = Number(search.hop)
    return { hop: search.hop != null && Number.isFinite(hop) ? hop : undefined }
  },
})

const hopStatusIcon = {
  ok: RiCheckboxCircleLine,
  timeout: RiCloseCircleLine,
  'high-latency': RiErrorWarningLine,
} as const

const hopStatusColor = {
  ok: 'text-emerald-500',
  timeout: 'text-destructive',
  'high-latency': 'text-amber-500',
} as const

function SessionDetailPage() {
  const { id } = Route.useParams()
  const { hop: hopIndex } = Route.useSearch()
  const navigate = useNavigate()
  const session = getSession(id)
  const setSegments = useBreadcrumbStore(s => s.setSegments)

  const safeHopIndex =
    hopIndex != null && session ? Math.min(Math.max(0, hopIndex), session.hops.length - 1) : null
  const selectedHop = safeHopIndex != null ? session?.hops[safeHopIndex] : null

  // Breadcrumb: Sessions > Game (> IP if hop selected)
  React.useEffect(() => {
    if (!session) return
    const segments: BreadcrumbSegment[] = selectedHop
      ? [
          {
            label: session.game,
            onClick: () =>
              navigate({
                to: '/sessions/$id',
                params: { id },
                search: { hop: undefined },
              }),
          },
          { label: selectedHop.ip },
        ]
      : [{ label: session.game }]
    setSegments(segments)
    return () => setSegments([])
  }, [session, selectedHop, id, navigate, setSegments])

  if (!session) {
    return (
      <div>
        <h1 className="text-2xl font-bold">{m.page_session_detail_title()}</h1>
        <p className="text-muted-foreground mt-2">Session not found.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <SidebarProvider open={true}>
        <Sidebar collapsible="none" className="bg-background border-r">
          <SidebarHeader>
            <Button
              className="pl-0 self-start"
              variant="ghost"
              size="xs"
              render={<Link to="/sessions" />}
            >
              <RiArrowLeftLine className="size-3.5" />
              {m.page_sessions_title()}
            </Button>
            <div>
              <h2 className="text-sm font-medium">{session.game}</h2>
              <p className="text-muted-foreground text-xs mt-0.5">{session.server}</p>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={safeHopIndex == null}
                    onClick={() =>
                      navigate({
                        to: '/sessions/$id',
                        params: { id },
                        search: { hop: undefined },
                        replace: true,
                      })
                    }
                  >
                    <RiDashboardLine />
                    <span>{m.session_overview()}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel>{m.session_route()}</SidebarGroupLabel>
              <SidebarMenu>
                {session.hops.map((h, i) => {
                  const Icon = hopStatusIcon[h.status]
                  return (
                    <SidebarMenuItem key={h.hop}>
                      <SidebarMenuButton
                        isActive={safeHopIndex === i}
                        onClick={() =>
                          navigate({
                            to: '/sessions/$id',
                            params: { id },
                            search: { hop: i },
                            replace: true,
                          })
                        }
                      >
                        <Icon className={hopStatusColor[h.status]} />
                        <div className="flex flex-1 items-center gap-2 min-w-0">
                          <span className="truncate font-mono">{h.ip}</span>
                          {h.latency >= 0 && (
                            <span className="ml-auto text-muted-foreground tabular-nums shrink-0">
                              {h.latency}ms
                            </span>
                          )}
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <div className="flex-1 overflow-y-auto p-4 overflow-auto">
          {selectedHop ? <HopDetail hop={selectedHop} /> : <SessionOverview session={session} />}
        </div>
      </SidebarProvider>
    </div>
  )
}

function SessionOverview({ session }: { session: Session }) {
  const validLatencies = session.hops.filter(h => h.latency >= 0).map(h => h.latency)
  const avgLatency = validLatencies.length
    ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
    : 0
  const maxLatency = validLatencies.length ? Math.max(...validLatencies) : 0
  const okCount = session.hops.filter(h => h.status === 'ok').length
  const timeoutCount = session.hops.filter(h => h.status === 'timeout').length
  const highLatencyCount = session.hops.filter(h => h.status === 'high-latency').length

  const statusVariant = {
    completed: 'secondary',
    active: 'default',
    failed: 'destructive',
  } as const

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">{session.game}</h2>
          <Badge variant={statusVariant[session.status]}>{session.status}</Badge>
        </div>
        <p className="text-muted-foreground text-xs mt-1">
          {session.server} &middot; {session.region}
        </p>
      </div>

      <Separator />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiTimeLine className="size-3.5 text-muted-foreground" />
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">{formatDuration(session.duration)}</p>
            <p className="text-muted-foreground text-xs">{formatDate(session.date)}</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiServerLine className="size-3.5 text-muted-foreground" />
              Hops
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-medium">{session.hops.length}</p>
            <div className="text-muted-foreground text-xs flex gap-2 mt-0.5">
              <span className="text-emerald-500">{okCount} ok</span>
              {highLatencyCount > 0 && (
                <span className="text-amber-500">{highLatencyCount} slow</span>
              )}
              {timeoutCount > 0 && <span className="text-destructive">{timeoutCount} timeout</span>}
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiMapPinLine className="size-3.5 text-muted-foreground" />
              Latency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-3">
              <div>
                <span
                  className={cn(
                    'text-lg font-medium',
                    avgLatency < 30
                      ? 'text-emerald-500'
                      : avgLatency < 50
                      ? 'text-amber-500'
                      : 'text-destructive'
                  )}
                >
                  {avgLatency}
                </span>
                <span className="text-muted-foreground text-xs ml-0.5">ms avg</span>
              </div>
              <div>
                <span
                  className={cn(
                    'text-lg font-medium',
                    maxLatency < 30
                      ? 'text-emerald-500'
                      : maxLatency < 50
                      ? 'text-amber-500'
                      : 'text-destructive'
                  )}
                >
                  {maxLatency}
                </span>
                <span className="text-muted-foreground text-xs ml-0.5">ms max</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function HopDetail({ hop }: { hop: SessionHop }) {
  const Icon = hopStatusIcon[hop.status]

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium">Hop {hop.hop}</h2>
          <Badge
            variant={
              hop.status === 'ok'
                ? 'secondary'
                : hop.status === 'timeout'
                ? 'destructive'
                : 'outline'
            }
          >
            <Icon className={cn('size-3', hopStatusColor[hop.status])} />
            {hop.status}
          </Badge>
        </div>
        <p className="text-muted-foreground text-xs mt-1 font-mono">{hop.ip}</p>
      </div>

      <Separator />

      <div className="grid gap-3 sm:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiServerLine className="size-3.5 text-muted-foreground" />
              Hostname
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xs break-all">{hop.hostname}</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiMapPinLine className="size-3.5 text-muted-foreground" />
              Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs">{hop.location}</p>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RiTimeLine className="size-3.5 text-muted-foreground" />
              Latency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs">
              {hop.latency >= 0 ? (
                <span
                  className={cn(
                    'text-lg font-medium',
                    hop.latency < 30
                      ? 'text-emerald-500'
                      : hop.latency < 50
                      ? 'text-amber-500'
                      : 'text-destructive'
                  )}
                >
                  {hop.latency}
                  <span className="text-muted-foreground text-xs ml-0.5">ms</span>
                </span>
              ) : (
                <span className="text-destructive">Timeout</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

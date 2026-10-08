import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { getSessionDetail, deleteSession, retryTraceroutes } from '@/lib/tauri'
import { errorMessage } from '@/lib/utils'
import { useBreadcrumbStore, type BreadcrumbSegment } from '@/stores/breadcrumb-store'
import { Button } from '@/components/ui/button'
import { SidebarProvider } from '@/components/ui/sidebar'
import { EmptyState } from '@/components/empty-state'
import { DetailSidebar, type SortMode } from '@/components/session/detail-sidebar'
import { SessionOverview } from '@/components/session/session-overview'
import { PeriodDetail } from '@/components/session/period-detail'
import { DetailSkeleton } from '@/components/session/detail-skeleton'

export const Route = createFileRoute('/sessions/$id')({
  component: SessionDetailPage,
  validateSearch: (search: Record<string, unknown>) => {
    const period = Number(search.period)
    return {
      period: search.period != null && Number.isFinite(period) ? period : undefined,
    }
  },
})

function SessionDetailPage() {
  const { id } = Route.useParams()
  const { period: selectedPeriodId } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSegments = useBreadcrumbStore(s => s.setSegments)
  const [sortMode, setSortMode] = useState<SortMode>('time')
  const [sortAsc, setSortAsc] = useState(true)

  const numericId = Number(id)
  const isValidId = Number.isInteger(numericId) && numericId > 0

  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['session', numericId],
    queryFn: () => getSessionDetail(numericId),
    enabled: isValidId,
    staleTime: 60_000,
    refetchInterval: query => (query.state.data?.endedAt === null ? 3_000 : false),
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSession(numericId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      navigate({ to: '/sessions' })
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) || m.session_delete_error())
    },
  })

  const retryMutation = useMutation({
    mutationFn: () => retryTraceroutes(numericId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', numericId] })
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) || m.session_retry_error())
    },
  })

  useEffect(() => {
    if (!detail) return
    const selectedPeriod = detail.ipPeriods.find(p => p.id === selectedPeriodId)
    const segments: BreadcrumbSegment[] = selectedPeriod
      ? [
          {
            label: detail.gameName,
            onClick: () =>
              navigate({
                to: '/sessions/$id',
                params: { id },
                search: { period: undefined },
              }),
          },
          { label: selectedPeriod.ip },
        ]
      : [{ label: detail.gameName }]
    setSegments(segments)
    return () => setSegments([])
  }, [detail, selectedPeriodId, id, navigate, setSegments])

  if (!isValidId || (detail === null && !isLoading)) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold">{m.page_session_detail_title()}</h1>
        <EmptyState
          className="mt-6"
          title={m.session_not_found()}
          action={
            <Button onClick={() => navigate({ to: '/sessions' })}>{m.dashboard_view_all()}</Button>
          }
        />
      </div>
    )
  }

  if (isLoading) return <DetailSkeleton />

  if (isError || !detail) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold">{m.page_session_detail_title()}</h1>
        <p className="text-destructive mt-2">{m.session_loading_error()}</p>
      </div>
    )
  }

  const selectedPeriod = detail.ipPeriods.find(p => p.id === selectedPeriodId)

  return (
    <div className="flex h-full">
      <SidebarProvider open={true} className="min-h-0">
        <DetailSidebar
          detail={detail}
          selectedPeriodId={selectedPeriodId}
          sortMode={sortMode}
          sortAsc={sortAsc}
          onSortChange={setSortMode}
          onSortDirectionChange={() => setSortAsc(prev => !prev)}
          onSelectOverview={() =>
            navigate({
              to: '/sessions/$id',
              params: { id },
              search: { period: undefined },
              replace: true,
            })
          }
          onSelectPeriod={periodId =>
            navigate({
              to: '/sessions/$id',
              params: { id },
              search: { period: periodId },
              replace: true,
            })
          }
          onDelete={() => deleteMutation.mutate()}
        />
        <div className="flex-1 overflow-y-auto p-4">
          {selectedPeriod ? (
            <PeriodDetail
              period={selectedPeriod}
              summary={detail.ipSummaries.find(s => s.ip === selectedPeriod.ip)}
              traceroute={detail.traceroutes.find(t => t.targetIp === selectedPeriod.ip)}
            />
          ) : (
            <SessionOverview
              detail={detail}
              onRetry={() => retryMutation.mutate()}
              isRetrying={retryMutation.isPending}
            />
          )}
        </div>
      </SidebarProvider>
    </div>
  )
}

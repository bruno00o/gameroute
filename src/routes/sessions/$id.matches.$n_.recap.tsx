import { useCallback, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import { formatDay } from '@/lib/format'
import { useMatchRecap } from '@/hooks/use-match-recap'
import { useSessionData } from '@/hooks/use-session-data'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { DetailSkeleton } from '@/components/session/detail-skeleton'
import { RecapScreen } from '@/components/session/recap-screen'
import { SessionGone, SessionLoadError } from '@/components/session/session-states'

export const Route = createFileRoute('/sessions/$id/matches/$n_/recap')({
  component: RecapPage,
})

function RecapPage() {
  const { id, n } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSegments = useBreadcrumbStore(s => s.setSegments)

  const sessionId = Number(id)
  const { valid, ongoing, detailQuery, matchesQuery } = useSessionData(sessionId)
  const detail = detailQuery.data
  const matches = matchesQuery.data
  const match = matches?.find(item => String(item.number) === n)
  const recapQuery = useMatchRecap(sessionId, match?.periodId, ongoing)

  const backToSession = useCallback(
    () => navigate({ to: '/sessions/$id', params: { id }, search: { period: undefined } }),
    [navigate, id]
  )
  const openMatch = useCallback(
    () => navigate({ to: '/sessions/$id/matches/$n', params: { id, n } }),
    [navigate, id, n]
  )

  useEffect(() => {
    if (!detail) return
    setSegments([
      { label: formatDay(detail.startedAt, { weekday: true }), onClick: backToSession },
      { label: m.match_title({ number: n }), onClick: openMatch },
      { label: m.recap_scope() },
    ])
    return () => setSegments([])
  }, [detail, n, backToSession, openMatch, setSegments])

  if (!valid || detail === null) {
    return <SessionGone onBack={() => navigate({ to: '/sessions' })} />
  }

  if (detailQuery.isError || matchesQuery.isError) {
    return (
      <SessionLoadError
        onRetry={() => queryClient.invalidateQueries({ queryKey: ['session', sessionId] })}
      />
    )
  }

  if (!detail || !matches) return <DetailSkeleton />

  if (!match) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:px-6">
        <EmptyState
          title={m.match_gone()}
          action={<Button onClick={backToSession}>{m.match_back()}</Button>}
        />
      </div>
    )
  }

  if (recapQuery.isPending && !recapQuery.isError) return <DetailSkeleton />

  return (
    <div className="h-full overflow-y-auto">
      <RecapScreen
        detail={detail}
        matches={matches}
        match={match}
        recap={recapQuery.data}
        onOpenMatch={openMatch}
        onPrepareReport={() => navigate({ to: '/reports', search: { session: sessionId } })}
      />
    </div>
  )
}

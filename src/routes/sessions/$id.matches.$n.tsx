import { useCallback, useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import type { SessionMatch } from '@/types/backend'
import { formatDay } from '@/lib/format'
import { useSessionData } from '@/hooks/use-session-data'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import { useSettingsStore } from '@/stores/settings-store'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { DetailSkeleton } from '@/components/session/detail-skeleton'
import { MatchScreen } from '@/components/session/match-screen'
import { SessionGone, SessionLoadError } from '@/components/session/session-states'

export const Route = createFileRoute('/sessions/$id/matches/$n')({
  component: MatchPage,
})

function MatchPage() {
  const { id, n } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSegments = useBreadcrumbStore(s => s.setSegments)
  const detailed = useSettingsStore(s => s.advancedMode)

  const sessionId = Number(id)
  const { valid, detailQuery, matchesQuery, thresholds } = useSessionData(sessionId)
  const detail = detailQuery.data
  const matches = matchesQuery.data
  const match = matches?.find(item => String(item.number) === n)

  const backToSession = useCallback(
    () => navigate({ to: '/sessions/$id', params: { id } }),
    [navigate, id]
  )
  const selectMatch = useCallback(
    (target: SessionMatch) =>
      navigate({ to: '/sessions/$id/matches/$n', params: { id, n: String(target.number) } }),
    [navigate, id]
  )

  useEffect(() => {
    if (!detail) return
    setSegments([
      { label: formatDay(detail.startedAt, { weekday: true }), onClick: backToSession },
      { label: m.match_title({ number: n }) },
    ])
    return () => setSegments([])
  }, [detail, n, backToSession, setSegments])

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

  return (
    <div className="h-full overflow-y-auto">
      <MatchScreen
        detail={detail}
        matches={matches}
        match={match}
        thresholds={thresholds}
        detailed={detailed}
        onSelectMatch={selectMatch}
      />
    </div>
  )
}

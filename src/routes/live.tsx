import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import { currentMatch, currentTrace, liveScreen } from '@/lib/live'
import { flowServerLabel } from '@/lib/matches'
import { getMatchIncidents } from '@/lib/tauri'
import { useServiceHealthCheck } from '@/hooks/use-service-health-check'
import { useSessionData } from '@/hooks/use-session-data'
import { useLiveStore } from '@/stores/live-store'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { EmptyState } from '@/components/empty-state'
import { FrozenNotice } from '@/components/live/frozen-notice'
import { LiveMatch } from '@/components/live/live-match'
import { LiveWaiting } from '@/components/live/live-waiting'
import { Panel } from '@/components/panel'
import { SessionHeader } from '@/components/session/session-screen'

const INCIDENTS_REFRESH_MS = 5_000

export const Route = createFileRoute('/live')({
  component: LivePage,
})

function LivePage() {
  const status = useLiveStore(s => s.status)
  const series = useLiveStore(s => s.series)
  const isMonitoring = useMonitoringStore(s => s.isMonitoring)
  const currentGame = useMonitoringStore(s => s.currentGame)
  const currentSessionId = useMonitoringStore(s => s.currentSessionId)
  const { isServiceRunning, isLoading } = useServiceHealthCheck()

  const screen = liveScreen(status, { isMonitoring, hasGame: currentGame != null })
  const sessionId = status?.sessionId ?? currentSessionId ?? 0
  const { detailQuery, matchesQuery } = useSessionData(screen === 'idle' ? 0 : sessionId)
  const matches = matchesQuery.data
  const measured = screen === 'live' || screen === 'frozen'
  const { data: incidents } = useQuery({
    queryKey: ['live', 'incidents', sessionId],
    queryFn: () => getMatchIncidents(sessionId),
    enabled: measured && sessionId > 0,
    refetchInterval: screen === 'live' ? INCIDENTS_REFRESH_MS : false,
  })

  if (screen === 'idle') {
    return (
      <div className="h-full overflow-y-auto">
        <SessionHeader title={m.nav_live()} facts={[]} />
        <div className="px-4 pt-5 pb-6 sm:px-6">
          <Panel>
            <EmptyState title={m.live_idle_title()}>{m.live_idle_body()}</EmptyState>
          </Panel>
        </div>
      </div>
    )
  }

  if (!status || screen === 'waiting') {
    const gameName = status?.gameName ?? currentGame?.gameName ?? ''
    return (
      <div className="h-full overflow-y-auto">
        <SessionHeader title={m.live_waiting_title()} facts={gameName ? [gameName] : []} />
        <div className="px-4 pt-5 pb-6 sm:px-6">
          <LiveWaiting gameName={gameName} matches={matches ?? []} />
        </div>
      </div>
    )
  }

  const match = currentMatch(matches, status)
  const trace = currentTrace(detailQuery.data, status)
  const title = match
    ? `${status.gameName}, ${m.match_title({ number: String(match.number) })}`
    : status.gameName

  return (
    <div className="h-full overflow-y-auto">
      <SessionHeader title={title} facts={match ? [flowServerLabel(match)] : []} />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        {screen === 'frozen' && (
          <FrozenNotice status={status} serviceBanner={!isServiceRunning && !isLoading} />
        )}
        <LiveMatch
          status={status}
          series={series}
          incidents={incidents}
          match={match}
          trace={trace}
        />
      </div>
    </div>
  )
}

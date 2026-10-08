import * as m from '@/paraglide/messages'

export type LiveState = 'live' | 'measuring' | 'idle' | 'stale'

const labels: Record<LiveState, () => string> = {
  live: m.live_badge_live,
  measuring: m.live_badge_measuring,
  idle: m.live_badge_idle,
  stale: m.live_badge_stale,
}

export function liveStateLabel(state: LiveState): string {
  return labels[state]()
}

export function monitorLabel({
  liveState,
  isMonitoring,
  isManualMode,
}: {
  liveState: LiveState
  isMonitoring: boolean
  isManualMode: boolean
}): string {
  if (!isMonitoring) return m.monitoring_off()
  if (liveState === 'live' && isManualMode) return m.nav_live()
  return liveStateLabel(liveState)
}

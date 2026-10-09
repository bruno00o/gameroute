import { useQuery } from '@tanstack/react-query'

import { getMatchRecap } from '@/lib/tauri'

const LIVE_REFRESH_MS = 5_000

export function useMatchRecap(sessionId: number, periodId: number | undefined, ongoing = false) {
  const valid = Number.isInteger(sessionId) && sessionId > 0 && periodId != null

  return useQuery({
    queryKey: ['session', sessionId, 'recap', periodId],
    queryFn: () => getMatchRecap(sessionId, periodId!),
    enabled: valid,
    staleTime: ongoing ? 0 : 60_000,
    refetchInterval: ongoing ? LIVE_REFRESH_MS : false,
  })
}

import { useQuery } from '@tanstack/react-query'

import { getSessionDetail, getSessionMatches, getSeverityThresholds } from '@/lib/tauri'

const ONGOING_REFRESH_MS = 10_000

export function useSessionData(sessionId: number) {
  const valid = Number.isInteger(sessionId) && sessionId > 0

  const detailQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSessionDetail(sessionId),
    enabled: valid,
    staleTime: 60_000,
    refetchInterval: query => (query.state.data?.endedAt === null ? ONGOING_REFRESH_MS : false),
  })
  const ongoing = detailQuery.data?.endedAt === null

  const matchesQuery = useQuery({
    queryKey: ['session', sessionId, 'matches'],
    queryFn: () => getSessionMatches(sessionId),
    enabled: valid && detailQuery.data != null,
    staleTime: 60_000,
    refetchInterval: ongoing ? ONGOING_REFRESH_MS : false,
  })

  const { data: thresholds } = useQuery({
    queryKey: ['severity-thresholds'],
    queryFn: getSeverityThresholds,
    staleTime: Infinity,
  })

  return { valid, ongoing, detailQuery, matchesQuery, thresholds }
}

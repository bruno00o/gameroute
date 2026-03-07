import { useQuery } from '@tanstack/react-query'
import { checkCaptureServiceStatus } from '@/lib/tauri'

export function useServiceHealthCheck() {
  const { data, isLoading } = useQuery({
    queryKey: ['capture-service-status'],
    queryFn: checkCaptureServiceStatus,
    staleTime: 5 * 60 * 1000,
    // Retry every 10s while service is down (covers slow startup)
    refetchInterval: data => (data?.state.data?.running ? false : 10_000),
  })

  return {
    isServiceRunning: data?.running ?? true,
    isLoading,
  }
}

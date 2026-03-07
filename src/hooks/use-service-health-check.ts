import { useQuery } from '@tanstack/react-query'
import { checkCaptureServiceStatus } from '@/lib/tauri'

export function useServiceHealthCheck() {
  const { data, isLoading } = useQuery({
    queryKey: ['capture-service-status'],
    queryFn: checkCaptureServiceStatus,
    staleTime: 5 * 60 * 1000,
  })

  return {
    isServiceRunning: data?.running ?? true,
    isLoading,
  }
}

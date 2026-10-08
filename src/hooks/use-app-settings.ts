import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { AppSettings } from '@/types/backend'
import { getAppSettings } from '@/lib/tauri'

const APP_SETTINGS_KEY = ['app-settings'] as const

export function useAppSettings() {
  return useQuery({ queryKey: APP_SETTINGS_KEY, queryFn: getAppSettings, staleTime: Infinity })
}

export function useSaveAppSetting<T>(save: (value: T) => Promise<AppSettings>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: save,
    onSuccess: settings => queryClient.setQueryData(APP_SETTINGS_KEY, settings),
    onError: () => toast.error(m.settings_save_error()),
  })
}

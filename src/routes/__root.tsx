import { useEffect, useState } from 'react'
import { Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { RiAlertLine, RiLoopLeftLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { restartCaptureService } from '@/lib/tauri'
import { checkForAppUpdates } from '@/lib/updater'
import { ErrorBoundary } from '@/components/error-boundary'
import { Header } from '@/components/header'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { useAutoStartMonitoring } from '@/hooks/use-auto-start-monitoring'
import { useInitTraySettings } from '@/hooks/use-init-tray-settings'
import { useMonitoringEvents } from '@/hooks/use-monitoring-events'
import { useServiceHealthCheck } from '@/hooks/use-service-health-check'
import { useTracerouteEvents } from '@/hooks/use-traceroute-events'
import { useSettingsStore } from '@/stores/settings-store'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const onboardingCompleted = useSettingsStore(s => s.onboardingCompleted)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const isWelcome = pathname === '/welcome'

  useEffect(() => {
    if (!onboardingCompleted && !isWelcome) {
      navigate({ to: '/welcome' })
    } else if (onboardingCompleted && isWelcome) {
      navigate({ to: '/' })
    }
  }, [onboardingCompleted, isWelcome, navigate])

  if (isWelcome) {
    return (
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <Outlet />
        <Toaster />
      </ThemeProvider>
    )
  }

  return <MainLayout />
}

function MainLayout() {
  const localeVersion = useSettingsStore(s => s._localeVersion)
  const { isServiceRunning, isLoading } = useServiceHealthCheck()
  const queryClient = useQueryClient()
  const [isFixing, setIsFixing] = useState(false)
  useMonitoringEvents()
  useTracerouteEvents()
  useAutoStartMonitoring()
  useInitTraySettings()

  useEffect(() => {
    checkForAppUpdates(true)
  }, [])

  const handleFixService = async () => {
    setIsFixing(true)
    try {
      await restartCaptureService()
      toast.success(m.service_warning_fix_success())
      // Re-check service status after a short delay
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['capture-service-status'] })
      }, 2000)
    } catch {
      toast.error(m.service_warning_fix_error())
    } finally {
      setIsFixing(false)
    }
  }

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <ErrorBoundary>
        <SidebarProvider key={localeVersion}>
          <AppSidebar />
          <SidebarInset className="max-h-screen">
            <Header />
            {!isServiceRunning && !isLoading && (
              <div className="flex items-center gap-2 border-b border-watch/30 bg-watch-soft px-4 py-2 text-xs text-watch">
                <RiAlertLine className="size-4 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium">{m.service_warning_title()}</span>
                  {' — '}
                  {m.service_warning_body()}
                </div>
                <button
                  onClick={handleFixService}
                  disabled={isFixing}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-watch/40 px-2 py-0.5 text-xs font-medium text-watch transition-colors hover:bg-watch/15 disabled:opacity-50"
                >
                  <RiLoopLeftLine className={`size-3 ${isFixing ? 'animate-spin' : ''}`} />
                  {m.service_warning_fix()}
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ErrorBoundary>
      <Toaster />
    </ThemeProvider>
  )
}

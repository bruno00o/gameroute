import { useEffect, useState } from 'react'
import { Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { RiLoopLeftLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { restartCaptureService } from '@/lib/tauri'
import { checkForAppUpdatesOnStartup } from '@/lib/updater'
import { EmptyState } from '@/components/empty-state'
import { ErrorBoundary } from '@/components/error-boundary'
import { Header } from '@/components/header'
import { Notice } from '@/components/notice'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { ThemeProvider } from '@/components/theme-provider'
import { UpdateDialog } from '@/components/update-dialog'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { useAutoStartMonitoring } from '@/hooks/use-auto-start-monitoring'
import { useMonitoringEvents } from '@/hooks/use-monitoring-events'
import { useServiceHealthCheck } from '@/hooks/use-service-health-check'
import { useTracerouteEvents } from '@/hooks/use-traceroute-events'
import { useSettingsStore } from '@/stores/settings-store'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundScreen,
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

  useEffect(() => {
    checkForAppUpdatesOnStartup()
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
              <Notice
                tone="watch"
                banner
                title={m.service_warning_title()}
                action={
                  <Button size="sm" loading={isFixing} onClick={handleFixService}>
                    <RiLoopLeftLine />
                    {isFixing ? m.service_warning_fixing() : m.service_warning_fix()}
                  </Button>
                }
              >
                {m.service_warning_body()}
              </Notice>
            )}
            <div className="flex-1 min-h-0 overflow-hidden">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ErrorBoundary>
      <UpdateDialog />
      <Toaster />
    </ThemeProvider>
  )
}

function NotFoundScreen() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <div className="h-full overflow-y-auto p-4">
      <EmptyState
        title={m.not_found_title({ path: pathname })}
        action={<Button onClick={() => navigate({ to: '/' })}>{m.not_found_action()}</Button>}
      />
    </div>
  )
}

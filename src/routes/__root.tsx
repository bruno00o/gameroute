import { useEffect } from 'react'
import { Outlet, createRootRoute, useLocation, useNavigate } from '@tanstack/react-router'
import { RiAlertLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
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
  useMonitoringEvents()
  useTracerouteEvents()
  useAutoStartMonitoring()
  useInitTraySettings()

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <ErrorBoundary>
        <SidebarProvider key={localeVersion}>
          <AppSidebar />
          <SidebarInset className="max-h-screen">
            <Header />
            {!isServiceRunning && !isLoading && (
              <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-400">
                <RiAlertLine className="size-4 shrink-0" />
                <div>
                  <span className="font-medium">{m.service_warning_title()}</span>
                  {' — '}
                  {m.service_warning_body()}
                </div>
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

import { Outlet, createRootRoute } from '@tanstack/react-router'

import { ErrorBoundary } from '@/components/error-boundary'
import { Header } from '@/components/header'
import { AppSidebar } from '@/components/sidebar/app-sidebar'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { useAutoStartMonitoring } from '@/hooks/use-auto-start-monitoring'
import { useMonitoringEvents } from '@/hooks/use-monitoring-events'
import { useTracerouteEvents } from '@/hooks/use-traceroute-events'
import { useSettingsStore } from '@/stores/settings-store'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const localeVersion = useSettingsStore(s => s._localeVersion)
  useMonitoringEvents()
  useTracerouteEvents()
  useAutoStartMonitoring()

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <SidebarProvider key={localeVersion}>
        <AppSidebar />
        <SidebarInset className="max-h-screen">
          <Header />
          <ErrorBoundary>
            <div className="flex-1 min-h-0 overflow-hidden">
              <Outlet />
            </div>
          </ErrorBoundary>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </ThemeProvider>
  )
}

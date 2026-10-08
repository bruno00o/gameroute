import * as React from 'react'
import { Link, useLocation } from '@tanstack/react-router'

import { findNavItem, getNavigationGroups } from '@/lib/navigation'
import * as m from '@/paraglide/messages'
import { useServiceHealthCheck } from '@/hooks/use-service-health-check'
import { selectLiveState, useMonitoringStore } from '@/stores/monitoring-store'
import { LogoMark } from '@/components/logo-mark'
import { NavMain } from '@/components/sidebar/nav-main'
import { SidebarMonitor } from '@/components/sidebar/sidebar-monitor'
import { SidebarSearch } from '@/components/sidebar/sidebar-search'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { pathname } = useLocation()
  const { isServiceRunning } = useServiceHealthCheck()
  const liveState = useMonitoringStore(s => selectLiveState(s, isServiceRunning))
  const groups = getNavigationGroups(liveState)
  const activeKey = findNavItem(groups, pathname)?.key

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="flex flex-row items-center group-data-[collapsible=icon]:flex-col">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="rounded-sm group-data-[collapsible=icon]:mx-auto"
              render={<Link to="/" />}
            >
              <div className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-sm">
                <LogoMark aria-hidden className="size-[19px]" />
              </div>
              <span className="text-[15px] font-bold tracking-[-0.01em] [font-stretch:112%]">
                {m.nav_company_name()}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarCollapseToggle />
      </SidebarHeader>
      <SidebarContent>
        <SidebarSearch />
        <nav aria-label={m.nav_label()} className="flex flex-1 flex-col">
          {groups.map(group => (
            <NavMain
              key={group.key}
              group={group}
              activeKey={activeKey}
              className={cn(group.key === 'bottom' && 'mt-auto')}
            />
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMonitor liveState={liveState} />
      </SidebarFooter>
    </Sidebar>
  )
}

function SidebarCollapseToggle() {
  const { state } = useSidebar()

  return <SidebarTrigger className={cn(state === 'expanded' ? 'ml-auto' : 'mx-auto')} />
}

import * as React from 'react'
import { Link } from '@tanstack/react-router'

import { getNavigationData } from '@/lib/navigation'
import * as m from '@/paraglide/messages'
import { LogoMark } from '@/components/logo-mark'
import { MonitoringWidget } from '@/components/sidebar/monitoring-widget'
import { NavMain } from '@/components/sidebar/nav-main'
import { NavSecondary } from '@/components/sidebar/nav-secondary'
import { SidebarSearch } from '@/components/sidebar/sidebar-search'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { navMain, navAnalytics, navSecondary } = getNavigationData()

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="flex flex-row items-center group-data-[collapsible=icon]:flex-col">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/" />}>
              <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-sm">
                <LogoMark aria-hidden className="size-5" />
              </div>
              <span className="ml-1 truncate text-base font-semibold">{m.nav_company_name()}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarCollapseToggle />
      </SidebarHeader>
      <SidebarContent>
        <SidebarSearch />
        <NavMain group={navMain} />
        <NavMain group={navAnalytics} />
        <NavSecondary group={navSecondary} className="mt-auto">
          <MonitoringWidget />
        </NavSecondary>
      </SidebarContent>
    </Sidebar>
  )
}

function SidebarCollapseToggle() {
  const { state } = useSidebar()

  return <SidebarTrigger className={cn(state === 'expanded' ? 'ml-auto' : 'mx-auto')} />
}

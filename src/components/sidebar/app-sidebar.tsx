import * as React from 'react'
import { RiRouteLine } from '@remixicon/react'
import { Link } from '@tanstack/react-router'

import { getNavigationData } from '@/lib/navigation'
import * as m from '@/paraglide/messages'
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
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <RiRouteLine className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{m.nav_company_name()}</span>
                <span className="truncate text-xs">{m.nav_company_plan()}</span>
              </div>
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

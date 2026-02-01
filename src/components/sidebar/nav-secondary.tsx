import * as React from 'react'
import { Link, useLocation } from '@tanstack/react-router'

import type { NavGroup } from '@/lib/navigation'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export function NavSecondary({
  group,
  children,
  ...props
}: {
  group: NavGroup
  children?: React.ReactNode
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const location = useLocation()

  return (
    <SidebarGroup {...props}>
      {children}
      <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map(item => {
            const isActive =
              location.pathname === item.to || location.pathname.startsWith(item.to + '/')

            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton render={<Link to={item.to} />} size="sm" isActive={isActive}>
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

import { Link } from '@tanstack/react-router'

import type { NavGroup, NavKey } from '@/lib/navigation'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const navItemClassName =
  'text-ui text-muted-foreground gap-2.5 rounded-sm font-medium data-active:font-semibold data-active:shadow-[inset_0_0_0_1px_var(--line)] group-data-[collapsible=icon]:mx-auto'

export function NavMain({
  group,
  activeKey,
  className,
}: {
  group: NavGroup
  activeKey?: NavKey
  className?: string
}) {
  return (
    <SidebarGroup className={className}>
      {group.label && (
        <SidebarGroupLabel className="text-overline text-muted-foreground h-auto pb-1.5 uppercase [font-stretch:88%] group-data-[collapsible=icon]:-mt-5">
          {group.label}
        </SidebarGroupLabel>
      )}
      <SidebarMenu className="gap-px">
        {group.items.map(item => (
          <SidebarMenuItem key={item.key}>
            <SidebarMenuButton
              render={
                <Link
                  to={item.to}
                  activeOptions={{ exact: item.to === '/', includeSearch: false }}
                />
              }
              tooltip={item.title}
              isActive={item.key === activeKey}
              className={navItemClassName}
            >
              <span className="relative inline-flex shrink-0">
                <item.icon />
                {item.live && (
                  <span
                    data-slot="live-dot"
                    className="bg-signal ring-sidebar absolute -top-0.5 -right-[3px] size-[7px] rounded-full ring-2"
                  />
                )}
              </span>
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

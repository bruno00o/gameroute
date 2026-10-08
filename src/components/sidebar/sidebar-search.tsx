import * as React from 'react'
import { RiSearchLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { CommandMenu } from '@/components/sidebar/command-menu'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

export function SidebarSearch() {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <SidebarGroup>
      <SidebarGroupContent className="relative group-data-[collapsible=icon]:hidden">
        <button
          onClick={() => setOpen(true)}
          className="border-line-strong bg-muted text-ui text-ink-subtle hover:text-foreground flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm border pr-1.5 pl-8"
        >
          <span className="flex-1 text-left">{m.search_placeholder()}</span>
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <span>+</span>
            <Kbd>K</Kbd>
          </KbdGroup>
        </button>
        <RiSearchLine className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 opacity-50 select-none" />
      </SidebarGroupContent>
      <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={m.search_placeholder()}
            onClick={() => setOpen(true)}
            className="text-muted-foreground rounded-sm group-data-[collapsible=icon]:mx-auto"
          >
            <RiSearchLine />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <CommandMenu open={open} onOpenChange={setOpen} />
    </SidebarGroup>
  )
}

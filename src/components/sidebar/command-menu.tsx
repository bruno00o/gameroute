import { useNavigate } from '@tanstack/react-router'

import { getNavigationData } from '@/lib/navigation'
import * as m from '@/paraglide/messages'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { navMain, navAnalytics, navSecondary } = getNavigationData()
  const groups = [navMain, navAnalytics, navSecondary]

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.command_title()}
      description={m.command_description()}
    >
      <Command>
        <CommandInput placeholder={m.search_placeholder()} />
        <CommandList>
          <CommandEmpty>{m.command_empty()}</CommandEmpty>
          {groups.map((group, index) => (
            <div key={group.label}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={group.label}>
                {group.items.map(item => (
                  <CommandItem
                    key={item.to}
                    value={item.title}
                    onSelect={() => {
                      navigate({ to: item.to })
                      onOpenChange(false)
                    }}
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

import { useNavigate } from '@tanstack/react-router'

import { getNavigationGroups } from '@/lib/navigation'
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
  const groups = getNavigationGroups()

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
            <div key={group.key}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={group.label}>
                {group.items.map(item => (
                  <CommandItem
                    key={item.key}
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

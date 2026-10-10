import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { RiRouteLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { getNavigationGroups } from '@/lib/navigation'
import { getUsualRoute } from '@/lib/tauri'
import { zoneLabel } from '@/lib/route'
import { ROUTE_DAYS, routeOperators } from '@/lib/route-history'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
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
  const { data: routes } = useQuery({
    queryKey: ['sessions', 'usual-route', ROUTE_DAYS],
    queryFn: () => getUsualRoute(ROUTE_DAYS),
    enabled: open,
  })
  const operators = useMemo(() => routeOperators(routes ?? []), [routes])

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
          {operators.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={m.command_operators()}>
                {operators.map(operator => (
                  <CommandItem
                    key={`${operator.gameName}|${operator.key}`}
                    value={`${operator.name} ${operator.asn != null ? `AS${operator.asn}` : ''} ${operator.gameName}`}
                    onSelect={() => {
                      navigate({
                        to: '/route',
                        search: { game: operator.gameName, operator: operator.key },
                      })
                      onOpenChange(false)
                    }}
                  >
                    <RiRouteLine className="size-4" />
                    <span>
                      {operator.name} ({zoneLabel(operator.zone).toLowerCase()})
                      {operator.asn != null && (
                        <span className="text-data-sm text-ink-subtle ml-2 font-mono">
                          AS{operator.asn}
                        </span>
                      )}
                    </span>
                    <CommandShortcut>{operator.gameName}</CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

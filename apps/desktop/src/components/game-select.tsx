import { Select as SelectPrimitive } from '@base-ui/react/select'
import { RiArrowDownSLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxSearch,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'

const SEARCH_ABOVE = 8
const ALL = '*'

type GameCount = { name: string; count: number }

type GameSelectProps = {
  games: readonly GameCount[]
  value: string | null
  onValueChange: (game: string | null) => void
  countLabel: (count: number) => string
  allowAll?: boolean
  className?: string
}

type Option = { value: string; name: string; count: number }

function options(games: readonly GameCount[], allowAll: boolean): Option[] {
  const sorted = [...games]
    .sort((a, b) => b.count - a.count)
    .map(game => ({ value: game.name, name: game.name, count: game.count }))
  if (!allowAll) return sorted
  const total = games.reduce((sum, game) => sum + game.count, 0)
  return [{ value: ALL, name: m.game_select_all(), count: total }, ...sorted]
}

const triggerClass = (className?: string) =>
  cn(
    buttonVariants({ variant: 'secondary', size: 'sm' }),
    'max-w-72 justify-between gap-1.5 pr-1.5 data-popup-open:bg-accent',
    className
  )

function TriggerLabel({ option }: { option: Option | undefined }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span aria-hidden="true" className="text-muted-foreground font-normal">
        {m.game_select_prefix()}
      </span>
      <span className="truncate">
        {option?.value === ALL ? m.game_select_all_short() : option?.name}
      </span>
    </span>
  )
}

function OptionContent({
  option,
  countLabel,
}: {
  option: Option
  countLabel: GameSelectProps['countLabel']
}) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{option.name}</span>
      <span
        aria-hidden="true"
        className="text-muted-foreground text-data-sm font-mono tabular-nums"
      >
        {formatNumber(option.count)}
      </span>
      <span className="sr-only">{countLabel(option.count)}</span>
    </>
  )
}

function GameSelect({
  games,
  value,
  onValueChange,
  countLabel,
  allowAll = false,
  className,
}: GameSelectProps) {
  const items = options(games, allowAll)
  const current =
    items.find(option => option.value === (value ?? ALL)) ?? (allowAll ? items[0] : undefined)
  const pick = (next: string) => onValueChange(next === ALL ? null : next)
  const label = m.game_select_label()

  if (games.length > SEARCH_ABOVE) {
    return (
      <Combobox<Option>
        items={items}
        value={current ?? null}
        onValueChange={option => option && pick(option.value)}
        itemToStringLabel={option => option.name}
        isItemEqualToValue={(a, b) => a.value === b.value}
      >
        <ComboboxTrigger
          data-slot="game-select"
          aria-label={label}
          className={triggerClass(className)}
        >
          <ComboboxValue>{() => <TriggerLabel option={current} />}</ComboboxValue>
        </ComboboxTrigger>
        <ComboboxContent aria-label={label} className="w-72">
          <ComboboxSearch
            placeholder={m.game_select_search()}
            aria-label={m.game_select_search()}
          />
          <ComboboxEmpty>{m.game_select_none()}</ComboboxEmpty>
          <ComboboxList>
            {(option: Option) => (
              <ComboboxItem key={option.value} value={option}>
                <OptionContent option={option} countLabel={countLabel} />
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    )
  }

  return (
    <Select value={current?.value ?? null} onValueChange={next => next != null && pick(next)}>
      <SelectPrimitive.Trigger
        data-slot="game-select"
        aria-label={label}
        className={triggerClass(className)}
      >
        <SelectPrimitive.Value>{() => <TriggerLabel option={current} />}</SelectPrimitive.Value>
        <SelectPrimitive.Icon
          render={<RiArrowDownSLine className="text-muted-foreground pointer-events-none size-4" />}
        />
      </SelectPrimitive.Trigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="start"
        className="w-auto min-w-(--anchor-width) max-w-80"
      >
        {items.map(option => (
          <SelectItem key={option.value} value={option.value} label={option.name}>
            <OptionContent option={option} countLabel={countLabel} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { GameSelect, type GameCount, type GameSelectProps }

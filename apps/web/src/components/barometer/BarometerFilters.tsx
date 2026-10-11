import { useId, useState } from 'react'
import { Small } from '@/components/Typography'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { COUNTRIES, type Country, GAMES } from '@/data/barometer'
import { countryName } from '@/lib/format'
import { m } from '@/paraglide/messages'

interface Props {
  country: Country
  gameId: string
  onCountryChange: (country: Country) => void
  onGameChange: (gameId: string) => void
}

export function BarometerFilters({ country, gameId, onCountryChange, onGameChange }: Props) {
  const id = useId()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = GAMES.filter(game => game.name.toLowerCase().includes(needle))
  const countries = COUNTRIES.map(code => ({ value: code, label: countryName(code) }))
  const zones = [{ value: 'all', label: m.filter_zone_all() }]

  return (
    <form
      aria-label={m.filters_label()}
      onSubmit={event => event.preventDefault()}
      className="flex flex-col gap-4 border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-country`} className="text-label text-muted-foreground">
            {m.filter_country()}
          </Label>
          <Select
            items={countries}
            value={country}
            onValueChange={value => value && onCountryChange(value as Country)}
          >
            <SelectTrigger id={`${id}-country`} className="min-w-[180px] text-ui">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {countries.map(item => (
                <SelectItem key={item.value} value={item.value} className="text-ui">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
          <Label htmlFor={`${id}-zone`} className="text-label text-muted-foreground">
            {m.filter_zone()}
          </Label>
          <Select items={zones} defaultValue="all">
            <SelectTrigger id={`${id}-zone`} className="min-w-[180px] text-ui">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {zones.map(item => (
                <SelectItem key={item.value} value={item.value} className="text-ui">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Small>{m.filter_zone_note()}</Small>
        </div>
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-game`} className="text-label text-muted-foreground">
          {m.filter_game()}
        </Label>
        <Input
          id={`${id}-game`}
          type="search"
          className="max-w-[440px] text-ui"
          placeholder={m.filter_game_placeholder()}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <ToggleGroup
          aria-label={m.filter_games_group()}
          variant="outline"
          spacing={1.5}
          className="flex-wrap"
          value={[gameId]}
          onValueChange={values => {
            const picked = values.find(value => value !== gameId)
            if (picked) onGameChange(picked)
          }}
        >
          {shown.map(game => (
            <ToggleGroupItem
              key={game.id}
              value={game.id}
              className="border-border-strong text-ui aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary-hover"
            >
              {game.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Small>{shown.length === 0 ? m.filter_games_none() : m.filter_games_note()}</Small>
      </div>
    </form>
  )
}

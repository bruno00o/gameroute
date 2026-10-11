import { useId, useState } from 'react'
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

  return (
    <form
      aria-label={m.filters_label()}
      onSubmit={event => event.preventDefault()}
      className="flex flex-col gap-[18px] rounded-[3px] border bg-surface p-[18px]"
    >
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-country`} className="gw-label">
            {m.filter_country()}
          </label>
          <select
            id={`${id}-country`}
            className="gw-select min-w-[180px]"
            value={country}
            onChange={event => onCountryChange(event.target.value as Country)}
          >
            {COUNTRIES.map(code => (
              <option key={code} value={code}>
                {countryName(code)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
          <label htmlFor={`${id}-zone`} className="gw-label">
            {m.filter_zone()}
          </label>
          <select id={`${id}-zone`} className="gw-select max-w-[260px]" defaultValue="all">
            <option value="all">{m.filter_zone_all()}</option>
          </select>
          <p className="gw-small">{m.filter_zone_note()}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t pt-3.5">
        <label htmlFor={`${id}-game`} className="gw-label">
          {m.filter_game()}
        </label>
        <input
          id={`${id}-game`}
          type="search"
          className="gw-input max-w-[440px]"
          placeholder={m.filter_game_placeholder()}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <div className="gw-chips" role="group" aria-label={m.filter_games_group()}>
          {shown.map(game => (
            <button
              key={game.id}
              type="button"
              className="gw-chip"
              aria-pressed={game.id === gameId}
              onClick={() => onGameChange(game.id)}
            >
              {game.name}
            </button>
          ))}
        </div>
        <p className="gw-small">
          {shown.length === 0 ? m.filter_games_none() : m.filter_games_note()}
        </p>
      </div>
    </form>
  )
}

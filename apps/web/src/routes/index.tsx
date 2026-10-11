import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { BarometerFilters } from '@/components/barometer/BarometerFilters'
import { IspRanking, RankingLegend } from '@/components/barometer/IspRanking'
import { ProblemZones } from '@/components/barometer/ProblemZones'
import { type Country, GAMES, getRanking } from '@/data/barometer'
import { countryName, formatNumber } from '@/lib/format'
import { pageHead } from '@/lib/head'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/')({
  head: () => pageHead({ title: m.meta_home_title(), description: m.meta_home_description() }),
  component: HomePage,
})

function HomePage() {
  const [country, setCountry] = useState<Country>('FR')
  const [gameId, setGameId] = useState(GAMES[0].id)
  const game = GAMES.find(g => g.id === gameId) ?? GAMES[0]
  const ranking = getRanking(game.id, country)

  return (
    <>
      <div className="border-b bg-tint-accent">
        <section className="gw-wrap flex flex-col gap-7 pt-[72px] pb-20">
          <div className="flex max-w-[820px] flex-col gap-[18px]">
            <h1 className="gw-display">{m.home_title()}</h1>
            <p className="gw-lead">{m.home_lead()}</p>
          </div>

          <BarometerFilters
            country={country}
            gameId={game.id}
            onCountryChange={setCountry}
            onGameChange={setGameId}
          />

          <div className="flex flex-wrap items-start gap-x-14 gap-y-8">
            <section
              aria-labelledby="ranking-title"
              className="flex min-w-0 flex-[999_1_620px] flex-col gap-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5">
                <h2 id="ranking-title" className="gw-h3">
                  {m.ranking_title({ game: game.name, country: countryName(country) })}
                </h2>
                <p className="gw-small">
                  {ranking.ranked.length > 0
                    ? m.ranking_sample({
                        players: formatNumber(ranking.players),
                        matches: formatNumber(ranking.matches),
                      })
                    : m.ranking_collecting()}
                </p>
              </div>
              <IspRanking ranking={ranking} gameName={game.name} />
              <RankingLegend />
            </section>

            <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 pt-1">
              <h2 className="gw-h3 text-[17px] leading-6">
                {m.aside_provides_title({ game: game.name })}
              </h2>
              <p className="gw-text text-sm leading-[22px]">
                {game.gameMeasuredPing ? m.aside_game_ping() : m.aside_no_ping()}
              </p>
              <h2 className="gw-h3 mt-2 text-[17px] leading-6">{m.aside_clean_title()}</h2>
              <p className="gw-text text-sm leading-[22px]">{m.aside_clean_text()}</p>
              <Link to="/methode" hash="barometre" className="text-sm leading-5">
                {m.aside_method_link()}
              </Link>
            </aside>
          </div>
        </section>
      </div>

      <ProblemZones />

      <section className="border-y bg-tint-calm">
        <div className="gw-wrap grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-x-[72px] gap-y-8 py-20">
          <div className="flex min-w-0 flex-col gap-3.5">
            <h2 className="gw-h2">{m.how_title()}</h2>
            <ul className="gw-list">
              <li>{m.how_probe()}</li>
              <li>{m.how_opt_in()}</li>
              <li>{m.how_bias()}</li>
            </ul>
            <p className="m-0 text-[15px] leading-6">
              <Link to="/methode" hash="barometre">
                {m.how_link()}
              </Link>
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-3.5">
            <h2 className="gw-h2">{m.add_title()}</h2>
            <p className="gw-text">{m.add_text()}</p>
            <div>
              <Link to="/telecharger" className="gr-btn gr-btn--primary gr-btn--lg">
                {m.add_cta()}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

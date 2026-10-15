import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { BarometerFilters } from '@/components/barometer/BarometerFilters'
import { IspRanking, RankingLegend } from '@/components/barometer/IspRanking'
import { ProblemZones } from '@/components/barometer/ProblemZones'
import { SourceBadge } from '@/components/barometer/SourceBadge'
import { Container } from '@/components/Container'
import { Display, Heading, Lead, List, Small, Text, Title } from '@/components/Typography'
import { LinkButton } from '@/components/LinkButton'
import { type Country, GAMES, getRanking } from '@/data/barometer'
import { countryName, formatNumber } from '@/lib/format'
import { pageHead } from '@/lib/head'
import { m } from '@/paraglide/messages'

export const Route = createFileRoute('/')({
  head: () =>
    pageHead({ title: m.meta_home_title(), description: m.meta_home_description(), path: '/' }),
  component: HomePage,
})

function HomePage() {
  const [country, setCountry] = useState<Country>('FR')
  const [gameId, setGameId] = useState(GAMES[0].id)
  const game = GAMES.find(g => g.id === gameId) ?? GAMES[0]
  const ranking = getRanking(game.id, country)

  return (
    <>
      <div className="border-b bg-tint-primary">
        <Container className="flex flex-col gap-7 pt-[72px] pb-20">
          <div className="flex max-w-[820px] flex-col gap-[18px]">
            <Display>{m.home_title()}</Display>
            <Lead>{m.home_lead()}</Lead>
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
                <Heading id="ranking-title">
                  {m.ranking_title({ game: game.name, country: countryName(country) })}
                </Heading>
                <Small>
                  {ranking.ranked.length > 0
                    ? m.ranking_sample({
                        players: formatNumber(ranking.players),
                        matches: formatNumber(ranking.matches),
                      })
                    : m.ranking_collecting()}
                </Small>
              </div>
              <IspRanking ranking={ranking} gameName={game.name} />
              <RankingLegend />
            </section>

            <aside className="flex min-w-0 flex-[1_1_300px] flex-col items-start gap-4 pt-1">
              <Heading className="text-subheading">
                {m.aside_provides_title({ game: game.name })}
              </Heading>
              <SourceBadge gameMeasured={game.gameMeasuredPing} />
              <Text className="text-[14px] leading-[22px]">
                {game.gameMeasuredPing ? m.aside_game_ping() : m.aside_no_ping()}
              </Text>
              <Heading className="mt-2 text-subheading">{m.aside_clean_title()}</Heading>
              <Text className="text-[14px] leading-[22px]">{m.aside_clean_text()}</Text>
              <Link to="/method" hash="barometer" className="text-[14px] leading-5">
                {m.aside_method_link()}
              </Link>
            </aside>
          </div>
        </Container>
      </div>

      <ProblemZones />

      <section className="border-y bg-tint-calm">
        <Container className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-x-[72px] gap-y-8 py-20">
          <div className="flex min-w-0 flex-col gap-3.5">
            <Title>{m.how_title()}</Title>
            <List>
              <li>{m.how_probe()}</li>
              <li>{m.how_opt_in()}</li>
              <li>{m.how_bias()}</li>
            </List>
            <p className="text-body">
              <Link to="/method" hash="barometer">
                {m.how_link()}
              </Link>
            </p>
          </div>
          <div className="flex min-w-0 flex-col items-start gap-3.5">
            <Title>{m.add_title()}</Title>
            <Text>{m.add_text()}</Text>
            <LinkButton to="/download" size="lg">
              {m.add_cta()}
            </LinkButton>
          </div>
        </Container>
      </section>
    </>
  )
}

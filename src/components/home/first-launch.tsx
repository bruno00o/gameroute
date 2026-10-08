import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { getGames } from '@/lib/tauri'
import { useServiceHealthCheck } from '@/hooks/use-service-health-check'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'

const GAMES_LIMIT = 1000
const NAMED_GAMES = 3

function gamesSentence(names: string[]): string {
  if (names.length === 0) return m.home_ready_no_games()
  if (names.length === 1) return m.home_ready_games_one({ name: names[0] })
  const shown = names.slice(0, NAMED_GAMES)
  const rest = names.length - shown.length
  const list = new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(
    rest > 0 ? [...shown, m.home_ready_more({ count: String(rest) })] : shown
  )
  return m.home_ready_games_other({ count: String(names.length), names: list })
}

function FirstLaunch() {
  const navigate = useNavigate()
  const { isServiceRunning, isLoading: serviceLoading } = useServiceHealthCheck()
  const { data: games } = useQuery({
    queryKey: ['games', 'monitored'],
    queryFn: async () =>
      (await getGames(GAMES_LIMIT, 0)).filter(game => game.monitored).map(game => game.name),
  })

  const facts = [
    games && gamesSentence(games),
    !serviceLoading && (isServiceRunning ? m.home_ready_service_on() : m.home_ready_service_off()),
  ].filter((fact): fact is string => Boolean(fact))

  return (
    <section data-slot="first-launch" className="flex flex-col gap-4">
      <EmptyState
        title={m.home_empty_title()}
        action={
          <Button size="sm" onClick={() => navigate({ to: '/games' })}>
            {m.sessions_empty_action()}
          </Button>
        }
      >
        {m.home_empty_body()}
      </EmptyState>
      {facts.length > 0 && (
        <ul className="text-ui marker:text-ink-subtle flex max-w-[60ch] list-disc flex-col gap-1.5 pl-5">
          {facts.map(fact => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

export { FirstLaunch }

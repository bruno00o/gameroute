import { useQuery } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import type { SessionMatch } from '@/types/backend'
import { formatClock, formatDuration } from '@/lib/format'
import { destinationName, ROUTE_DAYS } from '@/lib/route-history'
import { getUsualRoute } from '@/lib/tauri'
import { Panel } from '@/components/panel'
import { RouteStrip } from '@/components/route/route-strip'
import { StatusPill } from '@/components/status/status-pill'

type LiveWaitingProps = {
  gameName: string
  matches: SessionMatch[]
}

function LiveWaiting({ gameName, matches }: LiveWaitingProps) {
  const { data: routes } = useQuery({
    queryKey: ['sessions', 'usual-route', ROUTE_DAYS],
    queryFn: () => getUsualRoute(ROUTE_DAYS),
  })
  const usual = routes?.find(route => route.gameName === gameName)

  return (
    <div data-slot="live-waiting" className="flex flex-col gap-4">
      <Panel label={m.live_waiting_detected({ game: gameName })}>
        <p className="text-body text-muted-foreground max-w-[62ch]">{m.live_waiting_body()}</p>
      </Panel>
      {(usual || matches.length > 0) && (
        <div className="flex flex-wrap items-stretch gap-4">
          {usual && (
            <Panel
              label={m.live_waiting_usual({ game: gameName })}
              title={m.route_usual_matches({
                count: String(usual.traceCount),
                total: String(usual.totalTraces),
              })}
              className="flex-[999_1_480px]"
            >
              <RouteStrip
                route={usual.route}
                destination={{ name: destinationName(usual) }}
                persistentLoss={usual.persistentLoss}
              />
            </Panel>
          )}
          {matches.length > 0 && (
            <Panel label={m.live_waiting_matches()} className="flex-[1_1_260px]">
              <ul className="flex flex-col">
                {matches.map(match => (
                  <li
                    key={match.periodId}
                    className="text-ui grid min-h-10 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b last:border-b-0"
                  >
                    <span className="text-foreground">
                      {m.match_title({ number: String(match.number) })}
                      <span className="text-ink-subtle"> · {formatClock(match.startedAt)}</span>
                    </span>
                    <span className="text-data text-muted-foreground font-mono tabular-nums">
                      {formatDuration(match.durationSecs)}
                    </span>
                    <StatusPill status={match.status} size="sm" />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

export { LiveWaiting }

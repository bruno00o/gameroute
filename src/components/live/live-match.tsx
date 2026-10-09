import * as m from '@/paraglide/messages'
import type { LiveStatus, SessionMatch, TracerouteWithHops } from '@/types/backend'
import {
  ageText,
  frozenAge,
  matchClock,
  readingSeries,
  seriesEnd,
  type LiveSeries,
} from '@/lib/live'
import { flowServerName } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { hopCount } from '@/lib/route'
import { EmptyState } from '@/components/empty-state'
import { LiveReadout } from '@/components/live/live-readout'
import { Panel } from '@/components/panel'
import { RouteStrip } from '@/components/route/route-strip'

type LiveMatchProps = {
  status: LiveStatus
  series: LiveSeries
  match?: SessionMatch
  trace?: TracerouteWithHops
}

function LiveMatch({ status, series, match, trace }: LiveMatchProps) {
  const frozen = status.state === 'frozen'
  const points = readingSeries(series, status.primary?.point ?? null)
  const route = trace?.route
  const name =
    (match && flowServerName(match)) ?? shortOperatorName(route?.destinationName) ?? status.gameName

  return (
    <div data-slot="live-match" className="flex flex-wrap items-start gap-4">
      <LiveReadout
        reading={status.primary}
        frozen={frozen}
        points={points}
        end={seriesEnd(status, points)}
        elapsed={matchClock(status)}
        age={ageText(frozen ? frozenAge(status) : null)}
        region={status.region}
        className="max-w-[420px] flex-[1_1_340px]"
      />
      <Panel
        label={m.session_route()}
        title={trace && m.live_route_source({ hops: hopCount(trace.hops.length) })}
        className="flex-[999_1_480px]"
      >
        {route && trace ? (
          <RouteStrip route={route} destination={{ name, detail: trace.targetIp }} />
        ) : (
          <EmptyState compact title={m.live_route_pending()} />
        )}
      </Panel>
    </div>
  )
}

export { LiveMatch }

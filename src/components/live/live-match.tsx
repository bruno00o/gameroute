import * as m from '@/paraglide/messages'
import type { LiveStatus, MatchIncident, SessionMatch, TracerouteWithHops } from '@/types/backend'
import {
  ageText,
  frozenAge,
  matchClock,
  readingSeries,
  seriesEnd,
  type LiveSeries,
} from '@/lib/live'
import { matchIncidents, timelineCells, timelineEvents } from '@/lib/live-timeline'
import { liveVerdict } from '@/lib/live-verdict'
import { flowServerName } from '@/lib/matches'
import { shortOperatorName } from '@/lib/operators'
import { hopCount } from '@/lib/route'
import { EmptyState } from '@/components/empty-state'
import { LiveFlows } from '@/components/live/live-flows'
import { LivePoints } from '@/components/live/live-points'
import { LiveReadout } from '@/components/live/live-readout'
import { MatchTimeline } from '@/components/live/match-timeline'
import { Panel } from '@/components/panel'
import { RouteStrip } from '@/components/route/route-strip'
import { Verdict } from '@/components/session/verdict'

type LiveMatchProps = {
  status: LiveStatus
  series: LiveSeries
  incidents?: MatchIncident[]
  match?: SessionMatch
  trace?: TracerouteWithHops
}

function LiveMatch({ status, series, incidents = [], match, trace }: LiveMatchProps) {
  const frozen = status.state === 'frozen'
  const measured = status.state === 'live' || frozen
  const points = readingSeries(series, status.primary?.point ?? null)
  const route = trace?.route
  const name =
    (match && flowServerName(match)) ?? shortOperatorName(route?.destinationName) ?? status.gameName
  const verdict = liveVerdict(status)
  const own = matchIncidents(status, incidents)
  const cells = measured ? timelineCells(status, own) : []
  const events = timelineEvents(status, own)
  const clock = matchClock(status)

  return (
    <div data-slot="live-match" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-4">
        <LiveReadout
          reading={status.primary}
          frozen={frozen}
          points={points}
          end={seriesEnd(status, points)}
          elapsed={clock}
          age={ageText(frozen ? frozenAge(status) : null)}
          region={status.region}
          className="max-w-[420px] flex-[1_1_340px]"
        />
        {verdict && (
          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
            {verdict && (
              <Verdict
                status={verdict.status}
                title={verdict.title}
                zone={verdict.zone}
                zones={verdict.zones}
              >
                {verdict.body}
              </Verdict>
            )}
            {verdict && verdict.advice.length > 0 && (
              <Panel data-slot="live-advice" label={m.live_advice_label()}>
                <ul className="text-ui text-muted-foreground flex max-w-[62ch] list-disc flex-col gap-2 pl-4">
                  {verdict.advice.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </div>

      <Panel
        label={m.session_route()}
        title={trace && m.live_route_source({ hops: hopCount(trace.hops.length) })}
      >
        {route && trace ? (
          <RouteStrip route={route} destination={{ name, detail: trace.targetIp }} />
        ) : (
          <EmptyState compact title={m.live_route_pending()} />
        )}
      </Panel>

      {measured && (
        <div className="flex flex-wrap items-start gap-4">
          <LivePoints status={status} frozen={frozen} />
          <LiveFlows status={status} match={match} serverName={name} />
        </div>
      )}

      {cells.length > 0 && (
        <Panel
          data-slot="live-timeline"
          label={m.live_timeline_label()}
          title={timelineTitle(events.length, clock)}
        >
          <MatchTimeline cells={cells} events={events} elapsed={clock} />
        </Panel>
      )}
    </div>
  )
}

function timelineTitle(count: number, elapsed: string | null): string {
  const params = { elapsed: elapsed ?? '—' }
  if (count === 0) return m.live_timeline_clear(params)
  return count === 1
    ? m.live_timeline_incidents_one({ ...params, count: String(count) })
    : m.live_timeline_incidents_other({ ...params, count: String(count) })
}

export { LiveMatch }

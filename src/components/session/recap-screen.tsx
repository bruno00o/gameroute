import { RiArrowRightSLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { MatchRecap, SessionDetail, SessionMatch } from '@/types/backend'
import { formatElapsed } from '@/lib/format'
import { flowServerLabel, regionPingsText, traceOf } from '@/lib/matches'
import { hasRecap, recapHeadline, recapStatus } from '@/lib/recap'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { RecapFacts, RecapPointsPanel, RecapTimelinePanel } from '@/components/session/recap-panels'
import { SessionHeader } from '@/components/session/session-screen'
import { Verdict } from '@/components/session/verdict'

type RecapScreenProps = {
  detail: SessionDetail
  matches: SessionMatch[]
  match: SessionMatch
  recap: MatchRecap | null | undefined
  onOpenMatch?: () => void
  onPrepareReport?: () => void
}

function RecapScreen({
  detail,
  matches,
  match,
  recap,
  onOpenMatch,
  onPrepareReport,
}: RecapScreenProps) {
  const last = matches[matches.length - 1]
  const ended = detail.endedAt !== null || last?.periodId !== match.periodId
  const duration = formatElapsed(match.durationSecs)
  const number = String(match.number)
  const route = traceOf(match, detail.traceroutes)?.route

  return (
    <div data-slot="recap-screen" className="flex min-h-full flex-col">
      <SessionHeader
        title={
          ended
            ? m.recap_header_ended({ number, duration })
            : `${m.match_title({ number })} · ${duration}`
        }
        facts={[flowServerLabel(match)]}
        actions={
          <>
            {onPrepareReport && (
              <Button size="sm" variant="secondary" onClick={onPrepareReport}>
                {m.report_session_action()}
              </Button>
            )}
            {onOpenMatch && (
              <Button size="sm" onClick={onOpenMatch}>
                {m.recap_details()}
                <RiArrowRightSLine data-icon="inline-end" />
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        {hasRecap(recap) ? (
          <>
            <Verdict
              status={recapStatus(recap)}
              title={recapHeadline(recap)}
              scope={m.recap_scope()}
            />
            <Panel>
              <RecapFacts recap={recap} match={match} route={route} />
            </Panel>
            <RecapTimelinePanel recap={recap} />
            <RecapPointsPanel
              recap={recap}
              route={route}
              context={regionPingsText(match, detail.gameName)}
            />
          </>
        ) : (
          <Panel>
            <EmptyState
              compact
              title={m.recap_empty_title()}
              action={
                onOpenMatch && (
                  <Button variant="secondary" onClick={onOpenMatch}>
                    {m.recap_details()}
                  </Button>
                )
              }
            >
              {m.recap_empty_body()}
            </EmptyState>
          </Panel>
        )}
      </div>
    </div>
  )
}

export { RecapScreen, type RecapScreenProps }

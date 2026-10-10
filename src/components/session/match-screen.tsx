import { useEffect, useState } from 'react'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type {
  MatchRecap,
  MeasuredFlow,
  SessionDetail,
  SessionMatch,
  SeverityThresholds,
  TracerouteWithHops,
} from '@/types/backend'
import { formatClock, formatElapsed, formatMs, formatNumber } from '@/lib/format'
import {
  flowServerLabel,
  flowServerName,
  formatFlowPing,
  formatLoss,
  formatUsualPing,
  matchMeasure,
  measuredUpTo,
  pingSourceNote,
  regionPingsText,
  statusReason,
  thresholdRules,
  traceOf,
  traceSource,
  traceTiming,
  usualPing,
  type TraceTiming,
} from '@/lib/matches'
import { hasRecap } from '@/lib/recap'
import { formatRouteMs, hopCount } from '@/lib/route'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { Fact, FactRow } from '@/components/fact-row'
import { Panel } from '@/components/panel'
import { HopList } from '@/components/route/hop-list'
import { RouteMap } from '@/components/route/route-map'
import { RouteStrip } from '@/components/route/route-strip'
import { RecapTimelinePanel } from '@/components/session/recap-panels'
import { SessionHeader } from '@/components/session/session-screen'
import { StatusPill } from '@/components/status/status-pill'

type MatchScreenProps = {
  detail: SessionDetail
  matches: SessionMatch[]
  match: SessionMatch
  thresholds?: SeverityThresholds | null
  detailed?: boolean
  recap?: MatchRecap | null
  onSelectMatch?: (match: SessionMatch) => void
  onOpenRecap?: () => void
}

const IGNORED_TARGETS =
  'input, textarea, select, [contenteditable], [role=menu], [role=listbox], [role=dialog], [data-slot=route-map]'

function useArrowKeys(
  previous: SessionMatch | undefined,
  next: SessionMatch | undefined,
  onSelect: ((match: SessionMatch) => void) | undefined
) {
  useEffect(() => {
    if (!onSelect) return
    const onKeyDown = (event: KeyboardEvent) => {
      const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      const ignored = event.target instanceof Element && event.target.closest(IGNORED_TARGETS)
      if (event.defaultPrevented || modified || ignored) return
      const target =
        event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : undefined
      if (!target) return
      event.preventDefault()
      onSelect(target)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previous, next, onSelect])
}

function voiceSource(voice: MeasuredFlow, timing: TraceTiming | null): string | null {
  if (!timing || !voice.trace) return null
  return traceSource(
    timing.kind === 'during' ? { kind: 'at', time: voice.trace.startedAt } : timing
  )
}

function MatchFacts({
  match,
  traceroute,
  timing,
  detailed,
  pending,
  context,
}: {
  match: SessionMatch
  traceroute: TracerouteWithHops | undefined
  timing: TraceTiming | null
  detailed: boolean
  pending: boolean
  context: string | null
}) {
  const regions = context && (
    <p data-slot="region-pings" className="text-label text-muted-foreground mt-3">
      {context}
    </p>
  )
  const trace = matchMeasure(match)
  const number = String(match.number)

  if (trace?.pingMs == null) {
    return (
      <Panel label={m.match_measures()}>
        <EmptyState
          compact
          title={
            pending
              ? m.verdict_title_pending_one({ number })
              : m.verdict_title_unmeasured_one({ number })
          }
        >
          {pending ? m.verdict_pending_body() : m.verdict_unmeasured_body()}
        </EmptyState>
        {regions}
      </Panel>
    )
  }

  const worst = traceroute?.hops.find(hop => hop.hopNumber === trace.measuredHop)?.latencyMax
  const note = detailed ? m.matches_note() : m.matches_note_simple()

  return (
    <Panel
      label={m.match_measures()}
      title={match.game ? null : timing && traceSource(timing)}
      footer={match.game ? m.match_note_game() : note}
    >
      <FactRow>
        <Fact label={m.matches_col_ping()} detail={pingSourceNote(match, traceroute?.route)}>
          {formatFlowPing(trace)}
        </Fact>
        <Fact label={m.matches_col_loss()}>{formatLoss(trace.lossPct)}</Fact>
        {detailed && <Fact label={m.matches_col_jitter()}>{formatMs(trace.jitterMs)}</Fact>}
        {detailed && (
          <Fact label={m.match_worst()}>
            {worst != null && formatRouteMs(worst, !trace.atDestination)}
          </Fact>
        )}
      </FactRow>
      {regions}
    </Panel>
  )
}

function MatchRoute({
  match,
  traceroute,
  timing,
  detailed,
  className,
}: {
  match: SessionMatch
  traceroute: TracerouteWithHops | undefined
  timing: TraceTiming | null
  detailed: boolean
  className?: string
}) {
  const [showMap, setShowMap] = useState(false)

  if (!traceroute) {
    return (
      <Panel label={m.session_route()} className={className}>
        <EmptyState compact title={m.match_no_trace()} />
      </Panel>
    )
  }

  const name = flowServerName(match)
  const title = [timing && traceSource(timing), hopCount(traceroute.hops.length)]
    .filter(Boolean)
    .join(', ')

  return (
    <Panel
      label={m.session_route()}
      title={title}
      className={className}
      action={
        traceroute.hops.some(hop => hop.ip) && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showMap}
            onClick={() => setShowMap(open => !open)}
          >
            {showMap ? m.route_hide_map() : m.route_show_map()}
          </Button>
        )
      }
    >
      {traceroute.route && (
        <RouteStrip
          className="mb-4"
          route={traceroute.route}
          destination={{ name, detail: traceroute.targetIp }}
          persistentLoss={match.trace?.lossPct}
        />
      )}
      <HopList
        hops={traceroute.hops}
        targetIp={traceroute.targetIp}
        route={traceroute.route}
        mode={detailed ? 'detail' : 'simple'}
        destinationName={name}
      />
      {showMap && (
        <RouteMap
          className="mt-4"
          hops={traceroute.hops}
          targetIp={traceroute.targetIp}
          route={traceroute.route}
        />
      )}
    </Panel>
  )
}

function StatusReason({
  match,
  thresholds,
}: {
  match: SessionMatch
  thresholds?: SeverityThresholds | null
}) {
  const trace = matchMeasure(match)
  const usual = trace ? formatUsualPing(trace) : null
  const body =
    trace?.pingMs == null
      ? m.match_why_unmeasured_body()
      : usual
        ? m.match_why_body_usual({ usual, count: String(trace.usual!.sampleCount) })
        : m.match_why_body()

  return (
    <Panel tone="sunken" label={m.match_why_label()} title={statusReason(match, thresholds)}>
      <p className="text-ui text-muted-foreground max-w-[60ch]">{body}</p>
      {thresholds && (
        <dl
          aria-label={m.match_why_thresholds()}
          className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2"
        >
          {thresholdRules(thresholds, usualPing(trace)).map(({ level, rule }) => {
            const current = match.status === level
            return (
              <div key={level} data-current={current || undefined} className="contents">
                <dt className="flex">
                  <StatusPill status={level} size="sm" />
                </dt>
                <dd
                  className={cn(
                    'text-data-sm font-mono tabular-nums',
                    current ? 'text-foreground font-semibold' : 'text-muted-foreground'
                  )}
                >
                  {rule}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </Panel>
  )
}

function VoicePanel({
  voice,
  matches,
  traceroutes,
  sessionEndedAt,
}: {
  voice: MeasuredFlow
  matches: SessionMatch[]
  traceroutes: TracerouteWithHops[]
  sessionEndedAt: string | null
}) {
  const trace = voice.trace
  const source = voiceSource(voice, traceTiming(voice, matches, sessionEndedAt))

  return (
    <Panel
      label={m.chronology_voice_lane()}
      title={flowServerLabel(voice)}
      action={<StatusPill status={voice.status} size="sm" />}
      footer={trace?.pingMs != null ? source : null}
    >
      <FactRow>
        <Fact
          label={m.matches_col_ping()}
          detail={
            trace ? measuredUpTo(trace, traceOf(voice, traceroutes)?.route) : m.matches_no_trace()
          }
        >
          {trace?.pingMs != null && formatFlowPing(trace)}
        </Fact>
        <Fact label={m.matches_col_start()}>{formatClock(voice.startedAt)}</Fact>
        <Fact label={m.matches_col_duration()}>{formatElapsed(voice.durationSecs)}</Fact>
      </FactRow>
    </Panel>
  )
}

function ServerPanel({ match, detailed }: { match: SessionMatch; detailed: boolean }) {
  const rate = match.durationSecs > 0 ? match.packetCount / match.durationSecs : null

  return (
    <Panel
      label={m.match_server_label()}
      title={detailed ? match.ip : undefined}
      footer={m.match_server_note()}
    >
      <FactRow>
        <Fact label={m.match_packets()}>{formatNumber(match.packetCount)}</Fact>
        <Fact label={m.match_packet_rate()}>
          {rate != null &&
            m.match_packet_rate_value({ rate: formatNumber(rate, rate < 10 ? 1 : 0) })}
        </Fact>
      </FactRow>
    </Panel>
  )
}

function MatchScreen({
  detail,
  matches,
  match,
  thresholds,
  detailed = false,
  recap,
  onSelectMatch,
  onOpenRecap,
}: MatchScreenProps) {
  const index = matches.findIndex(item => item.periodId === match.periodId)
  const previous = index > 0 ? matches[index - 1] : undefined
  const next = index >= 0 ? matches[index + 1] : undefined
  useArrowKeys(previous, next, onSelectMatch)

  const traceroute = traceOf(match, detail.traceroutes)
  const timing = traceTiming(match, matches, detail.endedAt)
  const title = `${m.match_title({ number: String(match.number) })}, ${formatClock(match.startedAt)} → ${formatClock(match.endedAt)}`

  return (
    <div data-slot="match-screen" className="flex min-h-full flex-col">
      <SessionHeader
        title={title}
        facts={[formatElapsed(match.durationSecs), flowServerLabel(match)]}
        actions={
          <>
            <StatusPill status={match.status} />
            {onOpenRecap && hasRecap(recap) && (
              <Button size="sm" variant="secondary" onClick={onOpenRecap}>
                {m.recap_open()}
              </Button>
            )}
            {onSelectMatch && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!previous}
                  focusableWhenDisabled
                  aria-keyshortcuts="ArrowLeft"
                  onClick={() => previous && onSelectMatch(previous)}
                >
                  <RiArrowLeftSLine data-icon="inline-start" />
                  {m.match_previous()}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!next}
                  focusableWhenDisabled
                  aria-keyshortcuts="ArrowRight"
                  onClick={() => next && onSelectMatch(next)}
                >
                  {m.match_next()}
                  <RiArrowRightSLine data-icon="inline-end" />
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        <MatchFacts
          match={match}
          traceroute={traceroute}
          timing={timing}
          detailed={detailed}
          pending={detail.endedAt === null && !matchMeasure(match)}
          context={regionPingsText(match, detail.gameName)}
        />
        {hasRecap(recap) && <RecapTimelinePanel recap={recap} />}
        <div className="flex flex-wrap items-start gap-4">
          <MatchRoute
            className="flex-[999_1_520px]"
            match={match}
            traceroute={traceroute}
            timing={timing}
            detailed={detailed}
          />
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            <StatusReason match={match} thresholds={thresholds} />
            {match.voice && (
              <VoicePanel
                voice={match.voice}
                matches={matches}
                traceroutes={detail.traceroutes}
                sessionEndedAt={detail.endedAt}
              />
            )}
            <ServerPanel match={match} detailed={detailed} />
          </div>
        </div>
      </div>
    </div>
  )
}

export { MatchScreen, type MatchScreenProps }

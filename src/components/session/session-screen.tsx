import { useMemo, type ReactNode } from 'react'
import { RiLoopLeftLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { SessionDetail, SessionMatch, SeverityThresholds } from '@/types/backend'
import { computeDurationSecs, formatDuration } from '@/lib/format'
import { flowServerName, sessionSpan, sessionVerdict } from '@/lib/matches'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/empty-state'
import { Panel } from '@/components/panel'
import { MatchChronology } from '@/components/session/match-chronology'
import { MatchTable } from '@/components/session/match-table'
import { Verdict } from '@/components/session/verdict'

type SessionScreenProps = {
  detail: SessionDetail
  matches: SessionMatch[]
  thresholds?: SeverityThresholds | null
  detailed?: boolean
  actions?: ReactNode
  onSelectMatch?: (match: SessionMatch) => void
  onRetry?: () => void
  retrying?: boolean
  now?: number
}

type CountMessage = (params: { count: string }) => string

function counted(count: number, one: CountMessage, other: CountMessage) {
  const params = { count: String(count) }
  return count === 1 ? one(params) : other(params)
}

function sharedName(names: (string | undefined)[]): string | null {
  const unique = new Set(names)
  const [only] = unique
  return unique.size === 1 && only ? only : null
}

function SessionHeader({
  title,
  facts,
  actions,
}: {
  title: string
  facts: string[]
  actions?: ReactNode
}) {
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-2.5 sm:px-6">
      <div className="flex min-w-0 flex-[1_1_320px] flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-title text-foreground font-stretch-[106%]">{title}</h1>
        {facts.length > 0 && (
          <p className="text-data-sm text-muted-foreground font-mono tabular-nums">
            {facts.join(', ')}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

function SessionScreen({
  detail,
  matches,
  thresholds,
  detailed = false,
  actions,
  onSelectMatch,
  onRetry,
  retrying = false,
  now,
}: SessionScreenProps) {
  const ongoing = detail.endedAt === null
  const voicePeriods = useMemo(
    () => detail.ipPeriods.filter(period => period.flowKind === 'voice'),
    [detail.ipPeriods]
  )
  const verdict = useMemo(
    () => sessionVerdict(matches, detail.traceroutes, thresholds, ongoing),
    [matches, detail.traceroutes, thresholds, ongoing]
  )

  const servers = new Set(matches.map(match => match.ip)).size
  const voiceServers = new Set(voicePeriods.map(period => period.ip)).size
  const facts = [
    formatDuration(computeDurationSecs(detail.startedAt, detail.endedAt)),
    counted(matches.length, m.session_matches_count_one, m.session_matches_count_other),
    servers > 0 && counted(servers, m.session_servers_count_one, m.session_servers_count_other),
    voiceServers > 0 &&
      counted(voiceServers, m.session_voice_count_one, m.session_voice_count_other),
  ].filter((fact): fact is string => Boolean(fact))

  const linkedVoice = new Map(
    matches.flatMap(match => (match.voice ? [[match.voice.ip, flowServerName(match.voice)]] : []))
  )
  const gameServer = sharedName(matches.map(flowServerName))
  const voiceServer = sharedName(voicePeriods.map(period => linkedVoice.get(period.ip)))

  return (
    <div data-slot="session-screen" className="flex min-h-full flex-col">
      <SessionHeader
        title={`${detail.gameName}, ${sessionSpan(detail)}`}
        facts={facts}
        actions={actions}
      />
      <div className="flex flex-col gap-4 px-4 pt-5 pb-6 sm:px-6">
        {verdict && (
          <Verdict
            status={verdict.status}
            title={verdict.title}
            scope={verdict.scope}
            zone={verdict.zone}
            zones={verdict.zones}
            action={
              verdict.status === 'unmeasured' &&
              !ongoing &&
              onRetry && (
                <Button size="sm" loading={retrying} onClick={onRetry}>
                  <RiLoopLeftLine data-icon="inline-start" />
                  {m.session_retry_traceroutes()}
                </Button>
              )
            }
          >
            {verdict.sentences.length > 0 ? verdict.sentences.join(' ') : null}
          </Verdict>
        )}

        {matches.length > 0 && (
          <Panel label={m.chronology_label()}>
            <MatchChronology
              startedAt={detail.startedAt}
              endedAt={detail.endedAt}
              matches={matches}
              voice={voicePeriods}
              matchesLabel={
                gameServer ? `${m.session_matches()}, ${gameServer}` : m.session_matches()
              }
              voiceLabel={
                voiceServer
                  ? `${m.chronology_voice_lane()}, ${voiceServer}`
                  : m.chronology_voice_lane()
              }
              now={now}
            />
          </Panel>
        )}

        {matches.length > 0 ? (
          <Panel
            label={m.session_matches()}
            flush
            footer={detailed ? m.matches_note() : m.matches_note_simple()}
          >
            <MatchTable
              matches={matches}
              traceroutes={detail.traceroutes}
              sessionEndedAt={detail.endedAt}
              gameName={detail.gameName}
              detailed={detailed}
              onSelect={onSelectMatch}
            />
          </Panel>
        ) : (
          <Panel label={m.session_matches()}>
            {ongoing ? (
              <EmptyState compact title={m.matches_waiting_title()}>
                {m.matches_waiting_body()}
              </EmptyState>
            ) : (
              <EmptyState compact title={m.matches_empty_title()}>
                {m.matches_empty_body()}
              </EmptyState>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}

export { SessionHeader, SessionScreen, type SessionScreenProps }

import { useId } from 'react'

import * as m from '@/paraglide/messages'
import type { SessionMatch, Severity } from '@/types/backend'
import { formatClock } from '@/lib/format'
import { severityLabel } from '@/lib/matches'
import { cn } from '@/lib/utils'

const TICK_STEPS_MIN = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720]
const MAX_TICKS = 6
const MAX_VOICE_TRACKS = 3
const TRACK_HEIGHT = 6
const TRACK_GAP = 2
const TRACK_PITCH = TRACK_HEIGHT + TRACK_GAP

const blockFill: Record<Severity, string> = {
  ok: 'bg-measured text-foreground',
  watch: 'bg-watch text-on-signal',
  degraded: 'bg-degraded text-on-signal',
  critical: 'bg-critical text-on-signal',
  unmeasured:
    'text-foreground bg-[repeating-linear-gradient(45deg,var(--line-strong)_0_1.5px,transparent_1.5px_5px)]',
}

type Span = { startedAt: string; endedAt: string }

type MatchChronologyProps = {
  startedAt: string
  endedAt: string | null
  matches: SessionMatch[]
  voice: Span[]
  matchesLabel: string
  voiceLabel: string
  now?: number
  className?: string
}

function ticks(start: number, end: number): number[] {
  const spanMin = (end - start) / 60_000
  const step = TICK_STEPS_MIN.find(s => spanMin / s <= MAX_TICKS) ?? 1440
  const first = new Date(start)
  const minutes = first.getHours() * 60 + first.getMinutes() + first.getSeconds() / 60
  const next = Math.ceil(minutes / step) * step
  first.setHours(0, next, 0, 0)
  const result: number[] = []
  for (let t = first.getTime(); t <= end; t += step * 60_000) result.push(t)
  return result
}

function packTracks(spans: Span[]): Span[][] {
  const tracks: { end: number; spans: Span[] }[] = []
  const sorted = [...spans].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  for (const span of sorted) {
    const start = Date.parse(span.startedAt)
    const track =
      tracks.find(t => t.end <= start) ??
      (tracks.length < MAX_VOICE_TRACKS ? undefined : tracks[tracks.length - 1])
    if (track) {
      track.spans.push(span)
      track.end = Math.max(track.end, Date.parse(span.endedAt))
    } else {
      tracks.push({ end: Date.parse(span.endedAt), spans: [span] })
    }
  }
  return tracks.map(t => t.spans)
}

function MatchChronology({
  startedAt,
  endedAt,
  matches,
  voice,
  matchesLabel,
  voiceLabel,
  now,
  className,
}: MatchChronologyProps) {
  const start = Date.parse(startedAt)
  const latest = Math.max(...[...matches, ...voice].map(span => Date.parse(span.endedAt)), start)
  const end = Math.max(
    endedAt ? Date.parse(endedAt) : Math.max(now ?? latest, latest),
    start + 60_000
  )
  const pct = (t: number) =>
    `${(((Math.min(Math.max(t, start), end) - start) / (end - start)) * 100).toFixed(2)}%`
  const box = (span: Span) => {
    const from = Date.parse(span.startedAt)
    const to = Math.max(Date.parse(span.endedAt), from)
    return {
      left: pct(from),
      width: `max(2px, calc(${pct(to)} - ${pct(from)} - 2px))`,
    }
  }
  const voiceTracks = packTracks(voice)
  const matchesId = useId()
  const voiceId = useId()

  return (
    <div
      data-slot="match-chronology"
      className={cn(
        'grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] items-center gap-x-3 gap-y-2',
        className
      )}
    >
      <p id={matchesId} className="text-label text-foreground [overflow-wrap:anywhere]">
        {matchesLabel}
      </p>
      <ol aria-labelledby={matchesId} className="bg-muted relative h-5">
        {matches.map(match => (
          <li
            key={match.periodId}
            data-status={match.status}
            style={box(match)}
            className={cn('absolute inset-y-0 overflow-hidden', blockFill[match.status])}
          >
            <span
              aria-hidden="true"
              className="text-data-sm absolute top-[3px] left-[5px] font-mono font-semibold"
            >
              {match.number}
            </span>
            <span className="sr-only">
              {m.chronology_match({
                number: String(match.number),
                start: formatClock(match.startedAt),
                end: formatClock(match.endedAt),
              })}
              {`, ${severityLabel(match.status)}`}
            </span>
          </li>
        ))}
      </ol>

      {voiceTracks.length > 0 && (
        <>
          <p id={voiceId} className="text-label text-foreground [overflow-wrap:anywhere]">
            {voiceLabel}
          </p>
          <ol
            aria-labelledby={voiceId}
            style={{ height: voiceTracks.length * TRACK_PITCH + TRACK_GAP }}
            className="bg-muted relative"
          >
            {voiceTracks.flatMap((track, i) =>
              track.map(span => (
                <li
                  key={`${span.startedAt}-${span.endedAt}-${i}`}
                  style={{ ...box(span), top: TRACK_GAP + i * TRACK_PITCH, height: TRACK_HEIGHT }}
                  className="bg-viz-2 absolute"
                >
                  <span className="sr-only">
                    {m.chronology_voice({
                      start: formatClock(span.startedAt),
                      end: formatClock(span.endedAt),
                    })}
                  </span>
                </li>
              ))
            )}
          </ol>
        </>
      )}

      <span aria-hidden="true" />
      <div aria-hidden="true" className="relative h-3.5">
        {ticks(start, end).map(t => (
          <span
            key={t}
            style={{ left: pct(t) }}
            className="text-data-sm text-ink-subtle absolute top-0 -translate-x-1/2 font-mono whitespace-nowrap tabular-nums"
          >
            {formatClock(new Date(t).toISOString())}
          </span>
        ))}
      </div>
    </div>
  )
}

export { MatchChronology, type MatchChronologyProps }

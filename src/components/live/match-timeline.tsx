import * as m from '@/paraglide/messages'
import type { Severity } from '@/types/backend'
import type { TimelineCell, TimelineEvent } from '@/lib/live-timeline'
import { severityLabel } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { severityText } from '@/components/status/severity-color'
import { SeverityGlyph } from '@/components/status/severity-glyph'

const cellFill: Record<Severity, string> = {
  ok: 'bg-measured',
  watch: 'bg-watch',
  degraded: 'bg-degraded',
  critical: 'bg-critical',
  unmeasured:
    'bg-[repeating-linear-gradient(45deg,var(--line-strong)_0_1.5px,transparent_1.5px_5px)]',
}

type MatchTimelineProps = {
  cells: TimelineCell[]
  events: TimelineEvent[]
  elapsed: string | null
  className?: string
}

function MatchTimeline({ cells, events, elapsed, className }: MatchTimelineProps) {
  const summary = m.live_timeline_summary({
    cells: String(cells.length),
    incidents: String(events.length),
  })

  return (
    <div data-slot="match-timeline" className={cn('flex flex-col gap-2', className)}>
      <div role="img" aria-label={summary} className="flex h-6 items-stretch gap-px">
        {cells.map(cell => (
          <span
            key={cell.index}
            data-slot="timeline-cell"
            data-status={cell.status}
            title={severityLabel(cell.status)}
            className={cn('min-w-0.5 flex-1', cellFill[cell.status])}
          />
        ))}
        <span data-slot="timeline-now" className="bg-foreground ml-px w-0.5 shrink-0" />
      </div>
      <div
        aria-hidden="true"
        className="text-data-sm text-ink-subtle flex justify-between font-mono tabular-nums"
      >
        <span>0:00</span>
        <span>{elapsed ? m.live_timeline_now({ elapsed }) : m.live_spark_now()}</span>
      </div>
      {events.length > 0 && (
        <ul className="mt-1 flex flex-col">
          {events.map(event => (
            <li
              key={event.id}
              data-status={event.status}
              className="text-ui grid min-h-9 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-3 border-t py-1.5"
            >
              <SeverityGlyph status={event.status} size={9} />
              <span className="text-data text-muted-foreground font-mono tabular-nums">
                {event.to
                  ? `${event.from} – ${event.to}`
                  : m.live_timeline_since({ from: event.from })}
              </span>
              <span className={cn('min-w-0 [overflow-wrap:anywhere]', severityText[event.status])}>
                {event.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export { MatchTimeline, type MatchTimelineProps }

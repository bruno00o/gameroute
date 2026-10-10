import * as m from '@/paraglide/messages'
import type { Severity, TimelineCell } from '@/types/backend'
import { formatDuration, formatElapsed } from '@/lib/format'
import { formatRouteMs } from '@/lib/route'
import { severityLabel } from '@/lib/matches'
import { cn } from '@/lib/utils'
import { SeverityGlyph } from '@/components/status/severity-glyph'

const TICK_STEPS_SECS = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
const MAX_TICKS = 6
const CELL_WIDTH = 10
const CHART_HEIGHT = 40
const CHART_PADDING = 3

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
  bucketSecs: number
  durationSecs: number
  className?: string
}

function ticks(durationSecs: number): number[] {
  const step = TICK_STEPS_SECS.find(s => durationSecs / s <= MAX_TICKS) ?? 14400
  const result: number[] = []
  for (let t = step; t <= durationSecs * 0.92; t += step) result.push(t)
  return result
}

function segments(cells: TimelineCell[], y: (ping: number) => number): string[] {
  const paths: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length === 1) {
      const [x, height] = current[0].split(',').map(Number)
      current = [`${x - 3},${height}`, `${x + 3},${height}`]
    }
    if (current.length > 0) paths.push(`M${current.join('L')}`)
    current = []
  }
  cells.forEach((cell, i) => {
    if (cell.pingMs == null) return flush()
    current.push(`${i * CELL_WIDTH + CELL_WIDTH / 2},${y(cell.pingMs).toFixed(1)}`)
  })
  flush()
  return paths
}

function Latency({ cells }: { cells: TimelineCell[] }) {
  const values = cells.flatMap(cell => cell.pingMs ?? [])
  if (values.length === 0) return null
  const max = Math.max(...values)
  const top = max * 1.1
  const y = (ping: number) =>
    CHART_HEIGHT - CHART_PADDING - (ping / top) * (CHART_HEIGHT - CHART_PADDING * 2)

  return (
    <div data-slot="match-timeline-latency" className="relative">
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${cells.length * CELL_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        className="text-muted-foreground block h-10 w-full"
      >
        <line
          x1={0}
          x2={cells.length * CELL_WIDTH}
          y1={CHART_HEIGHT - CHART_PADDING}
          y2={CHART_HEIGHT - CHART_PADDING}
          stroke="var(--line)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {segments(cells, y).map(path => (
          <path
            key={path}
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <span className="text-label text-ink-subtle absolute top-0 right-0 font-mono tabular-nums">
        {m.recap_timeline_max({ value: formatRouteMs(max) })}
      </span>
    </div>
  )
}

function cellTitle(cell: TimelineCell, bucketSecs: number): string {
  const range = `${formatElapsed(cell.offsetSecs)}–${formatElapsed(cell.offsetSecs + bucketSecs)}`
  const ping = cell.pingMs == null ? null : formatRouteMs(cell.pingMs)
  return [range, severityLabel(cell.status), ping].filter(Boolean).join(', ')
}

function MatchTimeline({ cells, bucketSecs, durationSecs, className }: MatchTimelineProps) {
  const total = Math.max(durationSecs, cells.length * bucketSecs, 1)
  const present = new Set(cells.map(cell => cell.status))
  const flagged = (['watch', 'degraded', 'critical'] as const).filter(status => present.has(status))

  return (
    <figure
      data-slot="match-timeline"
      aria-label={m.recap_timeline_aria({
        seconds: String(bucketSecs),
        duration: formatDuration(durationSecs),
      })}
      className={cn('flex flex-col gap-1.5', className)}
    >
      <Latency cells={cells} />
      <ol aria-hidden="true" className="flex h-3 gap-px">
        {cells.map(cell => (
          <li
            key={cell.offsetSecs}
            data-status={cell.status}
            title={cellTitle(cell, bucketSecs)}
            className={cn('min-w-px flex-1', cellFill[cell.status])}
          />
        ))}
      </ol>
      <div
        aria-hidden="true"
        className="text-label text-ink-subtle relative h-4 font-mono tabular-nums"
      >
        <span className="absolute left-0">{formatElapsed(0)}</span>
        {ticks(total).map(t => (
          <span
            key={t}
            style={{ left: `${(t / total) * 100}%` }}
            className="absolute -translate-x-1/2"
          >
            {formatElapsed(t)}
          </span>
        ))}
      </div>
      <figcaption className="text-label text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn('size-2.5', cellFill.ok)} />
          {m.recap_legend_ok()}
        </span>
        {flagged.map(status => (
          <span key={status} className="flex items-center gap-1.5">
            <SeverityGlyph status={status} size={9} />
            {severityLabel(status)}
          </span>
        ))}
        {present.has('unmeasured') && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('size-2.5', cellFill.unmeasured)} />
            {m.recap_legend_unmeasured()}
          </span>
        )}
      </figcaption>
    </figure>
  )
}

export { MatchTimeline, type MatchTimelineProps }

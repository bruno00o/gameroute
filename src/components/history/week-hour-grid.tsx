import type { CSSProperties } from 'react'

import * as m from '@/paraglide/messages'
import type { SeverityThresholds, WeekHourGame } from '@/types/backend'
import { formatNumber } from '@/lib/format'
import { severityLabel } from '@/lib/matches'
import {
  NEUTRAL_LEVELS,
  cellDescription,
  cellKey,
  cellTint,
  formatGapCompact,
  gridFacts,
  hourLabel,
  hours,
  indexCells,
  neutralStep,
  weekdayName,
  weekdays,
  type CellTint,
} from '@/lib/week-hour'
import { cn } from '@/lib/utils'
import { SeverityGlyph } from '@/components/status/severity-glyph'

const HEAT = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3']

const HATCHED =
  'repeating-linear-gradient(45deg, var(--unmeasured-soft) 0 1.5px, transparent 1.5px 4px)'

type BeyondThreshold = 'watch' | 'degraded' | 'critical'

const statusClass: Record<BeyondThreshold, string> = {
  watch: 'bg-heat-watch shadow-[inset_0_0_0_1px_var(--watch)]',
  degraded: 'bg-heat-degraded shadow-[inset_0_0_0_1px_var(--degraded)]',
  critical: 'bg-heat-critical shadow-[inset_0_0_0_1px_var(--critical)]',
}

function appearance(tint: CellTint): { className?: string; style?: CSSProperties } {
  switch (tint.kind) {
    case 'never':
      return { style: { backgroundImage: HATCHED } }
    case 'unknown':
      return { className: 'border border-dashed border-line-strong' }
    case 'neutral':
      return { className: HEAT[tint.level] }
    case 'status':
      return { className: cn(statusClass[tint.status], 'text-foreground') }
  }
}

function Swatch({ tint }: { tint: CellTint }) {
  const { className, style } = appearance(tint)
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-2.5 w-3.5 shrink-0', className)}
      style={style}
    />
  )
}

type LegendProps = {
  game: WeekHourGame
  thresholds: SeverityThresholds
}

function Legend({ game, thresholds }: LegendProps) {
  const facts = gridFacts(game)
  const watchMs = thresholds.watch.overBaselineMs
  const step = neutralStep(watchMs)
  const digits = Number.isInteger(step) ? 0 : 1
  const edge = (level: number) => formatNumber(step * level, digits)
  const statuses: BeyondThreshold[] = ['watch']
  if (facts.degraded) statuses.push('degraded')
  if (facts.critical) statuses.push('critical')

  return (
    <ul
      aria-label={m.history_legend_label()}
      className="text-label text-muted-foreground flex flex-wrap gap-x-5 gap-y-1.5 font-normal"
    >
      {Array.from({ length: NEUTRAL_LEVELS }, (_, level) => (
        <li key={level} data-slot="legend-neutral" className="flex items-center gap-1.5">
          <Swatch tint={{ kind: 'neutral', level }} />
          <span className="tabular-nums">
            {level === 0
              ? m.history_legend_below({ max: edge(1) })
              : m.history_legend_range({ min: edge(level), max: edge(level + 1) })}
          </span>
        </li>
      ))}
      {statuses.map(status => (
        <li key={status} data-slot="legend-status" className="flex items-center gap-1.5">
          <Swatch tint={{ kind: 'status', status }} />
          <span className="tabular-nums">
            {m.history_legend_status({
              status: severityLabel(status),
              ms: formatNumber(thresholds[status].overBaselineMs, 0),
            })}
          </span>
        </li>
      ))}
      {facts.hasUnknown && (
        <li data-slot="legend-unknown" className="flex items-center gap-1.5">
          <Swatch tint={{ kind: 'unknown' }} />
          {m.history_legend_unknown()}
        </li>
      )}
      <li data-slot="legend-never" className="flex items-center gap-1.5">
        <Swatch tint={{ kind: 'never' }} />
        {m.history_legend_never()}
      </li>
    </ul>
  )
}

type WeekHourGridProps = {
  game: WeekHourGame
  thresholds: SeverityThresholds
}

function WeekHourGridView({ game, thresholds }: WeekHourGridProps) {
  const cells = indexCells(game)
  const watchMs = thresholds.watch.overBaselineMs

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table
          data-slot="week-hour-grid"
          className="w-full min-w-[840px] table-fixed border-separate border-spacing-0.5"
        >
          <caption className="sr-only">{m.history_caption()}</caption>
          <thead>
            <tr>
              <td className="w-11" />
              {hours().map(hour => (
                <th
                  key={hour}
                  scope="col"
                  className="text-ink-subtle text-data-sm overflow-hidden text-left font-mono font-normal"
                >
                  <span className="sr-only">{hourLabel(hour)}</span>
                  {hour % 3 === 0 && <span aria-hidden="true">{hourLabel(hour)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekdays().map(weekday => (
              <tr key={weekday}>
                <th
                  scope="row"
                  className="text-label text-muted-foreground pr-2 text-left font-normal"
                >
                  {weekdayName(weekday, 'short')}
                </th>
                {hours().map(hour => {
                  const cell = cells.get(cellKey(weekday, hour))
                  const tint = cellTint(cell, watchMs)
                  const description = cellDescription(weekday, hour, cell)
                  const { className, style } = appearance(tint)
                  return (
                    <td
                      key={hour}
                      data-tint={tint.kind}
                      data-level={tint.kind === 'neutral' ? tint.level : undefined}
                      data-status={tint.kind === 'status' ? tint.status : undefined}
                      title={description}
                      className={cn('h-[22px] p-0 text-center align-middle', className)}
                      style={style}
                    >
                      <span className="sr-only">{description}</span>
                      {tint.kind === 'status' && cell && (
                        <span
                          aria-hidden="true"
                          className="text-data-sm flex items-center justify-center gap-0.5 font-mono font-semibold whitespace-nowrap tabular-nums"
                        >
                          <SeverityGlyph status={tint.status} size={8} className="text-current" />
                          {cell.overUsualMs != null &&
                            formatGapCompact(cell.overUsualMs, cell.atLeast)}
                        </span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend game={game} thresholds={thresholds} />
    </div>
  )
}

export { WeekHourGridView, type WeekHourGridProps }

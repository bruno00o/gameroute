import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import type { Severity, SeverityThresholds, WeekHourCell, WeekHourGame } from '@/types/backend'
import { formatMs, formatNumber } from '@/lib/format'
import { formatLoss, severityLabel } from '@/lib/matches'
import { formatRouteMs } from '@/lib/route'
import { counted } from '@/lib/route-history'

export const HISTORY_DAYS = [30, 90, 365] as const
export const DEFAULT_HISTORY_DAYS = 90
export const NEUTRAL_LEVELS = 4

const NBSP = ' '
const WEEKDAYS = 7
const HOURS = 24
const MONDAY = new Date(2024, 0, 1)

export type CellTint =
  | { kind: 'never' }
  | { kind: 'unknown' }
  | { kind: 'neutral'; level: number }
  | { kind: 'status'; status: Exclude<Severity, 'ok' | 'unmeasured'> }

export function isHistoryDays(value: unknown): value is (typeof HISTORY_DAYS)[number] {
  return HISTORY_DAYS.some(days => days === value)
}

export function cellKey(weekday: number, hour: number): number {
  return weekday * HOURS + hour
}

export function indexCells(game: WeekHourGame): Map<number, WeekHourCell> {
  return new Map(game.cells.map(cell => [cellKey(cell.weekday, cell.hour), cell]))
}

export function weekdayName(weekday: number, style: 'short' | 'long' = 'long'): string {
  const date = new Date(MONDAY.getFullYear(), MONDAY.getMonth(), MONDAY.getDate() + weekday)
  return new Intl.DateTimeFormat(getLocale(), { weekday: style }).format(date)
}

export function weekdays(): number[] {
  return Array.from({ length: WEEKDAYS }, (_, weekday) => weekday)
}

export function hours(): number[] {
  return Array.from({ length: HOURS }, (_, hour) => hour)
}

export function hourLabel(hour: number): string {
  return m.history_hour({ hour: String(hour) })
}

export function neutralStep(watchMs: number): number {
  return watchMs / NEUTRAL_LEVELS
}

function isBeyondThreshold(status: Severity): status is 'watch' | 'degraded' | 'critical' {
  return status === 'watch' || status === 'degraded' || status === 'critical'
}

export function cellTint(cell: WeekHourCell | undefined, watchMs: number): CellTint {
  if (!cell) return { kind: 'never' }
  if (isBeyondThreshold(cell.status)) return { kind: 'status', status: cell.status }
  if (cell.overUsualMs == null) return { kind: 'unknown' }
  const level = Math.floor(Math.max(0, cell.overUsualMs) / neutralStep(watchMs))
  return { kind: 'neutral', level: Math.min(NEUTRAL_LEVELS - 1, level) }
}

export function formatGap(overMs: number, atLeast = false): string {
  const digits = Math.abs(overMs) < 10 ? 1 : 0
  const sign = overMs < 0 ? '−' : '+'
  const value = `${sign}${formatMs(Math.abs(overMs), { digits })}`
  return atLeast ? `≥${NBSP}${value}` : value
}

export function formatGapCompact(overMs: number, atLeast = false): string {
  const sign = overMs < 0 ? '−' : '+'
  return `${atLeast ? '≥' : ''}${sign}${formatNumber(Math.abs(overMs), 0)}`
}

function pingText(cell: WeekHourCell): string {
  return formatRouteMs(cell.medianMs!, cell.atLeast)
}

export function cellDescription(
  weekday: number,
  hour: number,
  cell: WeekHourCell | undefined
): string {
  const params = { day: weekdayName(weekday), hour: hourLabel(hour) }
  if (!cell) return m.history_cell_never(params)

  const matches = counted(
    cell.matchCount,
    m.session_matches_count_one,
    m.session_matches_count_other
  )
  const parts: string[] = [m.history_cell_head({ ...params, matches })]

  if (cell.medianMs == null) {
    parts.push(m.history_cell_unmeasured())
  } else if (cell.usualMs != null && cell.overUsualMs != null) {
    parts.push(
      m.history_cell_gap({
        ping: pingText(cell),
        usual: formatRouteMs(cell.usualMs, cell.atLeast),
        gap: formatGap(cell.overUsualMs, cell.atLeast),
      })
    )
  } else {
    parts.push(m.history_cell_no_usual({ ping: pingText(cell) }))
  }

  if (cell.source === 'game') parts.push(m.ping_by_game())
  if (cell.lossPct) parts.push(m.home_loss({ loss: formatLoss(cell.lossPct) }))
  if (isBeyondThreshold(cell.status)) parts.push(severityLabel(cell.status))
  return parts.join(' · ')
}

export type GridFacts = {
  beyond: number
  hasAtLeast: boolean
  hasGame: boolean
  hasUnknown: boolean
  degraded: boolean
  critical: boolean
  widest: { weekday: number; hour: number; cell: WeekHourCell } | null
}

export function gridFacts(game: WeekHourGame): GridFacts {
  const facts: GridFacts = {
    beyond: 0,
    hasAtLeast: false,
    hasGame: false,
    hasUnknown: false,
    degraded: false,
    critical: false,
    widest: null,
  }
  for (const cell of game.cells) {
    if (isBeyondThreshold(cell.status)) facts.beyond += 1
    if (cell.status === 'degraded') facts.degraded = true
    if (cell.status === 'critical') facts.critical = true
    if (cell.medianMs != null && cell.atLeast) facts.hasAtLeast = true
    if (cell.source === 'game') facts.hasGame = true
    if (cell.overUsualMs == null) facts.hasUnknown = true
    const over = cell.overUsualMs
    if (over != null && over > 0 && over > (facts.widest?.cell.overUsualMs ?? 0)) {
      facts.widest = { weekday: cell.weekday, hour: cell.hour, cell }
    }
  }
  return facts
}

export function beyondText(count: number, watchMs: number): string {
  const ms = formatNumber(watchMs, 0)
  if (count === 0) return m.history_beyond_none({ ms })
  const params = { count: String(count), ms }
  return count === 1 ? m.history_beyond_one(params) : m.history_beyond_other(params)
}

export function gridTitle(
  game: WeekHourGame,
  thresholds: SeverityThresholds,
  usualMinSamples: number
): string {
  const facts = gridFacts(game)
  const watchMs = thresholds.watch.overBaselineMs
  const { widest } = facts
  if (!widest || widest.cell.overUsualMs == null) {
    return game.cells.some(cell => cell.overUsualMs != null)
      ? m.history_title_flat()
      : m.history_title_none({ min: String(usualMinSamples) })
  }
  const head = m.history_title_gap({
    gap: formatGap(widest.cell.overUsualMs, widest.cell.atLeast),
    day: weekdayName(widest.weekday),
    hour: hourLabel(widest.hour),
    measures: counted(widest.cell.comparedCount, m.history_measures_one, m.history_measures_other),
  })
  return `${head} ${beyondText(facts.beyond, watchMs)}`
}

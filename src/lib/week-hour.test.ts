import { describe, expect, it } from 'vitest'

import type { WeekHourCell, WeekHourGame } from '@/types/backend'
import { thresholds } from '@/test/session-fixtures'
import {
  cellDescription,
  cellTint,
  formatGap,
  formatGapCompact,
  gridFacts,
  gridTitle,
  weekdayName,
} from '@/lib/week-hour'

const NB = ' '

function cell(overrides: Partial<WeekHourCell> = {}): WeekHourCell {
  return {
    weekday: 4,
    hour: 21,
    matchCount: 6,
    sampleCount: 3,
    comparedCount: 3,
    source: 'trace',
    atLeast: true,
    medianMs: 8,
    usualMs: 5,
    overUsualMs: 3,
    lossPct: 0,
    status: 'ok',
    ...overrides,
  }
}

function game(cells: WeekHourCell[]): WeekHourGame {
  return {
    gameName: 'VALORANT',
    matchCount: cells.reduce((sum, item) => sum + item.matchCount, 0),
    firstPlayedAt: '2026-08-01T10:00:00Z',
    lastPlayedAt: '2026-10-07T21:00:00Z',
    cells,
  }
}

describe('cellTint', () => {
  const WATCH = 20

  it('leaves a small gap neutral, never a status colour', () => {
    expect(cellTint(cell({ overUsualMs: 3 }), WATCH)).toEqual({ kind: 'neutral', level: 0 })
    expect(cellTint(cell({ overUsualMs: 4 }), WATCH)).toEqual({ kind: 'neutral', level: 0 })
    expect(cellTint(cell({ overUsualMs: 19.9 }), WATCH)).toEqual({ kind: 'neutral', level: 3 })
  })

  it('grades the neutral tint in steps of a quarter of the watch threshold', () => {
    const levels = [0, 4.9, 5, 9.9, 10, 14.9, 15].map(over => {
      const tint = cellTint(cell({ overUsualMs: over }), WATCH)
      return tint.kind === 'neutral' ? tint.level : -1
    })
    expect(levels).toEqual([0, 0, 1, 1, 2, 2, 3])
  })

  it('keeps faster-than-usual cells at the lightest level', () => {
    expect(cellTint(cell({ overUsualMs: -2 }), WATCH)).toEqual({ kind: 'neutral', level: 0 })
  })

  it('uses a status colour only when the backend rates the cell beyond a threshold', () => {
    expect(cellTint(cell({ overUsualMs: 25, status: 'watch' }), WATCH)).toEqual({
      kind: 'status',
      status: 'watch',
    })
    expect(cellTint(cell({ overUsualMs: 120, status: 'critical' }), WATCH)).toEqual({
      kind: 'status',
      status: 'critical',
    })
  })

  it('distinguishes never played, played without a comparison, and compared', () => {
    expect(cellTint(undefined, WATCH)).toEqual({ kind: 'never' })
    expect(cellTint(cell({ overUsualMs: null, usualMs: null, comparedCount: 0 }), WATCH)).toEqual({
      kind: 'unknown',
    })
  })
})

describe('formatting', () => {
  it('signs the gap and flags lower bounds with a leading ≥', () => {
    expect(formatGap(3, true)).toBe(`≥${NB}+3.0${NB}ms`)
    expect(formatGap(13.7, false)).toBe(`+14${NB}ms`)
    expect(formatGap(-1.04)).toBe(`−1.0${NB}ms`)
    expect(formatGapCompact(39.7, true)).toBe('≥+40')
    expect(formatGapCompact(25)).toBe('+25')
  })
})

describe('cellDescription', () => {
  it('says there was no match for a cell that was never played', () => {
    expect(cellDescription(1, 3, undefined)).toBe('Tuesday 3:00 · no match')
  })

  it('flags a lower bound with ≥ on the ping, the usual and the gap', () => {
    const text = cellDescription(4, 21, cell({ overUsualMs: 3, medianMs: 8, usualMs: 5 }))

    expect(text).toContain('Friday 21:00 · 6 matches')
    expect(text).toContain(`≥${NB}8.0${NB}ms against ≥${NB}5.0${NB}ms usual, gap ≥${NB}+3.0${NB}ms`)
    expect(text).not.toContain('Watch')
  })

  it('does not flag a ping measured by the game and says so', () => {
    const text = cellDescription(
      4,
      21,
      cell({ atLeast: false, source: 'game', medianMs: 15, usualMs: 13, overUsualMs: 2 })
    )

    expect(text).not.toContain('≥')
    expect(text).toContain('measured by the game')
  })

  it('names the status and the loss of a cell beyond a threshold', () => {
    const text = cellDescription(
      6,
      15,
      cell({ weekday: 6, hour: 15, overUsualMs: 39.7, medianMs: 44, usualMs: 4.3, status: 'watch' })
    )

    expect(text).toContain('Watch')
    expect(cellDescription(6, 15, cell({ lossPct: 2.5, status: 'degraded' }))).toContain('2.5%')
  })

  it('says the usual is not established when there is nothing to compare with', () => {
    const text = cellDescription(
      4,
      21,
      cell({ usualMs: null, overUsualMs: null, comparedCount: 0 })
    )

    expect(text).toContain('usual not established yet')
    expect(
      cellDescription(4, 21, cell({ medianMs: null, overUsualMs: null, usualMs: null }))
    ).toContain('no ping measured')
  })
})

describe('gridTitle', () => {
  const rules = thresholds()

  it('states the widest gap with its measures and counts the cells beyond a threshold', () => {
    const title = gridTitle(
      game([
        cell({ weekday: 4, hour: 21, overUsualMs: 3 }),
        cell({ weekday: 5, hour: 22, overUsualMs: 14, comparedCount: 1 }),
      ]),
      rules,
      5
    )

    expect(title).toBe(
      `Largest gap: ≥${NB}+14${NB}ms on ${weekdayName(5)} at 22:00, over 1 measure. No cell beyond a threshold (+20 ms or loss).`
    )
  })

  it('counts the cells rated beyond a threshold', () => {
    const title = gridTitle(
      game([
        cell({ overUsualMs: 3 }),
        cell({ weekday: 6, hour: 15, overUsualMs: 39.7, comparedCount: 1, status: 'watch' }),
      ]),
      rules,
      5
    )

    expect(title).toContain('1 cell beyond a threshold (+20 ms or loss).')
  })

  it('explains what is missing when no cell can be compared yet', () => {
    const title = gridTitle(
      game([cell({ overUsualMs: null, usualMs: null, comparedCount: 0 })]),
      rules,
      5
    )

    expect(title).toBe(
      'No gap to show yet: a usual ping needs 5 earlier measures at the same point.'
    )
  })

  it('does not call a faster-than-usual cell a gap', () => {
    expect(gridTitle(game([cell({ overUsualMs: -1.2 })]), rules, 5)).toBe(
      'No cell slower than your usual ping.'
    )
  })
})

describe('gridFacts', () => {
  it('reports lower bounds, game pings and cells without a comparison', () => {
    const facts = gridFacts(
      game([
        cell({ atLeast: true }),
        cell({ weekday: 1, atLeast: false, source: 'game' }),
        cell({ weekday: 2, overUsualMs: null, usualMs: null }),
      ])
    )

    expect(facts).toMatchObject({ hasAtLeast: true, hasGame: true, hasUnknown: true, beyond: 0 })
  })
})

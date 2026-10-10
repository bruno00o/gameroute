import { describe, expect, it, vi } from 'vitest'
import {
  computeDurationSecs,
  formatBytes,
  formatClock,
  formatDay,
  formatDayTime,
  formatDuration,
  formatElapsed,
  formatMs,
  formatNumber,
  formatPercent,
} from './format'

vi.mock('@/paraglide/runtime', () => ({ getLocale: () => 'fr' }))

const NB = ' '

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(0, 'en')).toBe(`0${NB}s`)
    expect(formatDuration(45, 'en')).toBe(`45${NB}s`)
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(125, 'en')).toBe(`2${NB}min 5${NB}s`)
    expect(formatDuration(60, 'es')).toBe(`1${NB}min 0${NB}s`)
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(3_780, 'fr')).toBe(`1${NB}h 3${NB}min`)
  })

  it('names days per language', () => {
    const twoDaysFiveHours = 2 * 86_400 + 5 * 3_600
    expect(formatDuration(twoDaysFiveHours, 'fr')).toBe(`2${NB}j 5${NB}h`)
    expect(formatDuration(twoDaysFiveHours, 'en')).toBe(`2${NB}d 5${NB}h`)
    expect(formatDuration(twoDaysFiveHours, 'es')).toBe(`2${NB}d 5${NB}h`)
  })

  it('drops fractions of a second', () => {
    expect(formatDuration(12.7, 'en')).toBe(`12${NB}s`)
  })

  it('returns a dash for negative durations', () => {
    expect(formatDuration(-1, 'en')).toBe('—')
  })

  it('uses the active language by default', () => {
    expect(formatDuration(2 * 86_400)).toBe(`2${NB}j 0${NB}h`)
  })
})

describe('formatElapsed', () => {
  it('writes match durations as m:ss', () => {
    expect(formatElapsed(41)).toBe('0:41')
    expect(formatElapsed(2556)).toBe('42:36')
  })

  it('adds hours past sixty minutes', () => {
    expect(formatElapsed(3723)).toBe('1:02:03')
  })

  it('returns a dash for negative values', () => {
    expect(formatElapsed(-5)).toBe('—')
  })
})

describe('formatClock and formatDay', () => {
  const at = new Date(2026, 8, 13, 16, 27).toISOString()

  it('writes local clock times on 24 hours in every language', () => {
    expect(formatClock(at, 'fr')).toBe('16:27')
    expect(formatClock(at, 'en')).toBe('16:27')
  })

  it('names the day in the active language', () => {
    expect(formatDay(at, { weekday: true, now: new Date(2026, 9, 8) })).toBe('dim. 13 sept.')
  })

  it('returns a dash for invalid dates', () => {
    expect(formatClock('nope')).toBe('—')
  })
})

describe('formatDay', () => {
  const now = new Date(2026, 9, 8, 12, 0)
  const saturday = new Date(2026, 9, 3, 21, 7).toISOString()

  it('names the day and month per language', () => {
    expect(formatDay(saturday, { locale: 'fr', now })).toBe('3 oct.')
    expect(formatDay(saturday, { locale: 'en', now })).toBe('Oct 3')
    expect(formatDay(saturday, { weekday: true, locale: 'fr', now })).toBe('sam. 3 oct.')
  })

  it('adds the year only outside the current one', () => {
    const lastYear = new Date(2025, 11, 27, 20, 0).toISOString()
    expect(formatDay(lastYear, { locale: 'fr', now })).toBe('27 déc. 2025')
  })

  it('returns a dash for an unreadable date', () => {
    expect(formatDay('not a date')).toBe('—')
  })
})

describe('formatDayTime', () => {
  const now = new Date(2026, 9, 8, 12, 0)

  it('joins the day and the local time', () => {
    const saturday = new Date(2026, 9, 3, 21, 7).toISOString()
    expect(formatDayTime(saturday, { locale: 'fr', now })).toBe(`sam. 3 oct., 21:07`)
    expect(formatDayTime(saturday, { locale: 'es', now })).toBe(`sáb, 3 oct, 21:07`)
  })

  it('returns a dash for an unreadable date', () => {
    expect(formatDayTime('')).toBe('—')
  })
})

describe('computeDurationSecs', () => {
  it('computes duration between two dates', () => {
    const start = '2026-01-01T10:00:00Z'
    const end = '2026-01-01T10:05:30Z'
    expect(computeDurationSecs(start, end)).toBe(330)
  })

  it('uses Date.now when endedAt is null', () => {
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString()
    const result = computeDurationSecs(fiveSecondsAgo, null)
    expect(result).toBeGreaterThanOrEqual(4)
    expect(result).toBeLessThanOrEqual(6)
  })

  it('returns zero for same start and end', () => {
    const date = '2026-01-01T10:00:00Z'
    expect(computeDurationSecs(date, date)).toBe(0)
  })
})

describe('formatNumber', () => {
  it('uses the decimal separator of each language', () => {
    expect(formatNumber(0.4, 1, 'en')).toBe('0.4')
    expect(formatNumber(0.4, 1, 'fr')).toBe('0,4')
    expect(formatNumber(0.4, 1, 'es')).toBe('0,4')
  })

  it('returns a dash for missing values', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(Number.NaN)).toBe('—')
  })
})

describe('formatBytes', () => {
  it('picks a unit and writes it in the language', () => {
    expect(formatBytes(10_400_000, 'en')).toBe('10 MB')
    expect(formatBytes(2_450_000, 'fr')).toBe('2,5 Mo')
    expect(formatBytes(512_000, 'en')).toBe('512 kB')
    expect(formatBytes(1_200_000_000, 'es')).toBe('1,2 GB')
  })

  it('returns a dash for missing values', () => {
    expect(formatBytes(null)).toBe('—')
  })
})

describe('formatMs', () => {
  it('returns a dash for null', () => {
    expect(formatMs(null)).toBe('—')
  })

  it('keeps one decimal and a non-breaking space before the unit', () => {
    expect(formatMs(12.345, { locale: 'en' })).toBe(`12.3${NB}ms`)
    expect(formatMs(12.345, { locale: 'fr' })).toBe(`12,3${NB}ms`)
    expect(formatMs(12.345, { locale: 'es' })).toBe(`12,3${NB}ms`)
  })

  it('rounds to whole milliseconds on request', () => {
    expect(formatMs(17.6, { digits: 0, locale: 'en' })).toBe(`18${NB}ms`)
  })

  it('prefixes a silent destination with ≥', () => {
    expect(formatMs(17, { digits: 0, atLeast: true, locale: 'fr' })).toBe(`≥${NB}17${NB}ms`)
  })

  it('uses the active language by default', () => {
    expect(formatMs(0)).toBe(`0,0${NB}ms`)
  })
})

describe('formatPercent', () => {
  it('returns a dash for null', () => {
    expect(formatPercent(null)).toBe('—')
  })

  it('puts no space before % in English', () => {
    expect(formatPercent(33.33, { locale: 'en' })).toBe('33%')
  })

  it('puts a non-breaking space before % in French and Spanish', () => {
    expect(formatPercent(4, { locale: 'fr' })).toBe(`4${NB}%`)
    expect(formatPercent(100, { locale: 'es' })).toBe(`100${NB}%`)
  })

  it('keeps decimals with the local separator', () => {
    expect(formatPercent(0.5, { digits: 1, locale: 'fr' })).toBe(`0,5${NB}%`)
    expect(formatPercent(0.5, { digits: 1, locale: 'en' })).toBe('0.5%')
  })
})

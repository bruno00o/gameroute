import { describe, expect, it } from 'vitest'
import { computeDurationSecs, formatDuration, formatLoss, formatMs, latencyColor } from './format'

describe('formatDuration', () => {
  it('formats zero seconds', () => {
    expect(formatDuration(0)).toBe('0m 0s')
  })

  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('0m 45s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s')
  })

  it('formats exact minutes', () => {
    expect(formatDuration(60)).toBe('1m 0s')
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

describe('latencyColor', () => {
  it('returns empty string for null', () => {
    expect(latencyColor(null)).toBe('')
  })

  it('returns green for low latency', () => {
    expect(latencyColor(10)).toBe('text-emerald-500')
    expect(latencyColor(29)).toBe('text-emerald-500')
  })

  it('returns amber for moderate latency', () => {
    expect(latencyColor(30)).toBe('text-amber-500')
    expect(latencyColor(79)).toBe('text-amber-500')
  })

  it('returns destructive for high latency', () => {
    expect(latencyColor(80)).toBe('text-destructive')
    expect(latencyColor(200)).toBe('text-destructive')
  })
})

describe('formatMs', () => {
  it('returns dash for null', () => {
    expect(formatMs(null)).toBe('-')
  })

  it('formats with one decimal', () => {
    expect(formatMs(12.345)).toBe('12.3')
  })

  it('formats zero', () => {
    expect(formatMs(0)).toBe('0.0')
  })

  it('formats integer', () => {
    expect(formatMs(100)).toBe('100.0')
  })
})

describe('formatLoss', () => {
  it('returns dash for null', () => {
    expect(formatLoss(null)).toBe('-')
  })

  it('formats zero loss', () => {
    expect(formatLoss(0)).toBe('0%')
  })

  it('formats fractional loss rounded', () => {
    expect(formatLoss(33.33)).toBe('33%')
  })

  it('formats 100% loss', () => {
    expect(formatLoss(100)).toBe('100%')
  })
})

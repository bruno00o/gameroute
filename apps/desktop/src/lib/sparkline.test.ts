import { describe, expect, it } from 'vitest'

import { sparkGeometry } from './sparkline'

const END = 120_000
const at = (second: number) => END - 60_000 + second * 1000

function series(values: (number | null)[]) {
  return values.map((v, i) => ({ at: at(i + 1), v }))
}

const base = { end: END, width: 360, height: 84 }

describe('sparkGeometry', () => {
  it('puts the axis at zero below the highest value', () => {
    const geometry = sparkGeometry({ ...base, points: series([18, 20, 24]) })

    expect(geometry.top).toBeGreaterThanOrEqual(24)
    expect(geometry.baseline).toBeGreaterThan(0)
    expect(geometry.line.startsWith('M')).toBe(true)
    const ys = [...geometry.line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map(match => Number(match[1]))
    expect(Math.max(...ys)).toBeLessThan(geometry.baseline)
  })

  it('draws a min–max band around the line', () => {
    const geometry = sparkGeometry({ ...base, points: series([18, 40, 19, 21]) })
    expect(geometry.band.endsWith('Z')).toBe(true)
  })

  it('draws the usual ping as a line and keeps it inside the scale', () => {
    const geometry = sparkGeometry({ ...base, points: series([10, 11]), usual: 80 })

    expect(geometry.usualY).not.toBeNull()
    expect(geometry.usualY!).toBeGreaterThan(0)
    expect(geometry.usualY!).toBeLessThan(geometry.baseline)
    expect(geometry.top).toBeGreaterThanOrEqual(80)
  })

  it('leaves a gap and a loss mark for a lost probe, never a 0 ms point', () => {
    const geometry = sparkGeometry({ ...base, points: series([18, null, 19]) })

    expect(geometry.losses).toHaveLength(1)
    expect(geometry.line.match(/M/g)).toHaveLength(2)
    expect(geometry.line).not.toContain(` ${geometry.baseline.toFixed(1)}`)
  })

  it('ignores samples older than the minute', () => {
    const geometry = sparkGeometry({
      ...base,
      points: [{ at: at(-5), v: 500 }, ...series([18])],
    })
    expect(geometry.top).toBeLessThan(500)
  })

  it('has nothing to draw without samples', () => {
    const geometry = sparkGeometry({ ...base, points: [] })
    expect(geometry.line).toBe('')
    expect(geometry.last).toBeNull()
  })
})

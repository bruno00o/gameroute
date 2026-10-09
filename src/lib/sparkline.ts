import { BAND_WINDOW_MS, niceCeil, SERIES_WINDOW_MS, type SeriesPoint } from '@/lib/live'

export const SPARK_GUTTER = 30
export const SPARK_PAD_RIGHT = 6
export const SPARK_PAD_TOP = 4
export const SPARK_LOSS_ROW = 8

type Vertex = { x: number; y: number }
type Run = { vertices: Vertex[]; highs: Vertex[]; lows: Vertex[] }

export type SparkGeometry = {
  top: number
  baseline: number
  usualY: number | null
  line: string
  band: string
  losses: number[]
  last: Vertex | null
}

export type SparkInput = {
  points: SeriesPoint[]
  end: number
  windowMs?: number
  usual?: number | null
  width: number
  height: number
}

const fixed = (value: number) => value.toFixed(1)

function path(vertices: Vertex[]): string {
  return vertices.map((v, i) => `${i ? 'L' : 'M'}${fixed(v.x)} ${fixed(v.y)}`).join('')
}

export function sparkGeometry({
  points,
  end,
  windowMs = SERIES_WINDOW_MS,
  usual,
  width,
  height,
}: SparkInput): SparkGeometry {
  const start = end - windowMs
  const visible = points.filter(point => point.at > start && point.at <= end)
  const values = visible.flatMap(point => (point.v == null ? [] : [point.v]))
  const peak = Math.max(1, ...values, usual ?? 0)
  const top = niceCeil(peak * 1.1)

  const plotH = height - SPARK_LOSS_ROW - SPARK_PAD_TOP - 2
  const baseline = SPARK_PAD_TOP + plotH
  const plotW = width - SPARK_GUTTER - SPARK_PAD_RIGHT
  const x = (at: number) => SPARK_GUTTER + plotW * ((at - start) / windowMs)
  const y = (value: number) => SPARK_PAD_TOP + plotH * (1 - value / top)

  const runs: Run[] = []
  let current: Run | null = null
  const losses: number[] = []
  visible.forEach((point, index) => {
    if (point.v == null) {
      losses.push(x(point.at))
      current = null
      return
    }
    if (!current) {
      current = { vertices: [], highs: [], lows: [] }
      runs.push(current)
    }
    const near = visible
      .slice(0, index + 1)
      .filter(other => other.v != null && other.at > point.at - BAND_WINDOW_MS)
      .map(other => other.v as number)
    current.vertices.push({ x: x(point.at), y: y(point.v) })
    current.highs.push({ x: x(point.at), y: y(Math.max(...near)) })
    current.lows.push({ x: x(point.at), y: y(Math.min(...near)) })
  })

  const line = runs.map(run => path(run.vertices)).join('')
  const band = runs
    .filter(run => run.vertices.length > 1)
    .map(run => `${path(run.highs)}${path([...run.lows].reverse()).replace('M', 'L')}Z`)
    .join('')
  const lastRun = runs.at(-1)
  const lastPoint = visible.at(-1)

  return {
    top,
    baseline,
    usualY: usual == null ? null : y(usual),
    line,
    band,
    losses,
    last: lastPoint && lastPoint.v != null && lastRun ? (lastRun.vertices.at(-1) ?? null) : null,
  }
}

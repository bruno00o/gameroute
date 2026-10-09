import { MINI_WINDOW_MS, type MiniSample } from '@/lib/mini'
import { cn } from '@/lib/utils'

const WIDTH = 292
const HEIGHT = 36
const PAD = 3

export function MiniSparkline({
  samples,
  usualMs,
  label,
  live = false,
  className,
}: {
  samples: MiniSample[]
  usualMs?: number | null
  label: string
  live?: boolean
  className?: string
}) {
  const end = samples.length > 0 ? samples[samples.length - 1].at : 0
  const start = end - MINI_WINDOW_MS
  const values = samples.flatMap(sample => (sample.rttMs == null ? [] : [sample.rttMs]))
  const top = Math.max(10, ...values, usualMs ?? 0) * 1.15
  const x = (at: number) => ((at - start) / MINI_WINDOW_MS) * WIDTH
  const y = (ms: number) => HEIGHT - PAD - (ms / top) * (HEIGHT - PAD * 2)

  const runs: MiniSample[][] = []
  for (const sample of samples) {
    if (sample.rttMs == null) runs.push([])
    else if (runs.length === 0 || runs[runs.length - 1].length === 0) runs.push([sample])
    else runs[runs.length - 1].push(sample)
  }
  const lost = samples.filter(sample => sample.rttMs == null)
  const last = [...samples].reverse().find(sample => sample.rttMs != null)

  return (
    <svg
      role="img"
      aria-label={label}
      data-slot="mini-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      preserveAspectRatio="none"
      className={cn('block overflow-visible', className)}
    >
      <line
        x1={0}
        x2={WIDTH}
        y1={HEIGHT - 0.5}
        y2={HEIGHT - 0.5}
        className="stroke-border"
        vectorEffect="non-scaling-stroke"
      />
      {usualMs != null && usualMs > 0 && (
        <line
          data-slot="mini-usual"
          x1={0}
          x2={WIDTH}
          y1={y(usualMs)}
          y2={y(usualMs)}
          strokeDasharray="3 3"
          className="stroke-line-strong"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {runs
        .filter(run => run.length > 0)
        .map(run => (
          <polyline
            key={run[0].at}
            fill="none"
            strokeWidth={1.5}
            strokeLinejoin="round"
            points={run.map(sample => `${x(sample.at)},${y(sample.rttMs ?? 0)}`).join(' ')}
            className="stroke-current"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {lost.map(sample => (
        <line
          key={sample.at}
          data-slot="mini-lost"
          x1={x(sample.at)}
          x2={x(sample.at)}
          y1={HEIGHT - 5}
          y2={HEIGHT}
          className="stroke-line-strong"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {live && last && (
        <circle
          data-slot="mini-last"
          cx={x(last.at)}
          cy={y(last.rttMs ?? 0)}
          r={2.5}
          className="fill-signal"
        />
      )}
    </svg>
  )
}

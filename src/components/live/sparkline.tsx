import { useEffect, useRef, useState } from 'react'

import * as m from '@/paraglide/messages'
import type { Severity } from '@/types/backend'
import { formatMs, formatNumber } from '@/lib/format'
import { SERIES_WINDOW_MS, seriesLast, type SeriesPoint } from '@/lib/live'
import { SPARK_GUTTER, SPARK_LOSS_ROW, sparkGeometry } from '@/lib/sparkline'
import { cn } from '@/lib/utils'
import { severityText } from '@/components/status/severity-color'

const DEFAULT_WIDTH = 320

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width)
      if (next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}

type SparklineProps = {
  points: SeriesPoint[]
  end: number
  usual?: number | null
  atLeast?: boolean
  status?: Severity
  stale?: boolean
  label: string
  height?: number
  className?: string
}

function Sparkline({
  points,
  end,
  usual,
  atLeast = false,
  status = 'ok',
  stale = false,
  label,
  height = 84,
  className,
}: SparklineProps) {
  const [ref, width] = useWidth()
  const geometry = sparkGeometry({ points, end, usual, width, height })
  const tone = stale
    ? 'text-ink-subtle'
    : status === 'ok' || status === 'unmeasured'
      ? 'text-signal'
      : severityText[status]
  const lastValue = seriesLast(points)

  return (
    <div
      ref={ref}
      data-slot="sparkline"
      data-stale={stale || undefined}
      data-axis-min="0"
      data-axis-max={geometry.top}
      className={cn('min-w-0', className)}
    >
      <svg
        role="img"
        aria-label={
          lastValue == null ? label : `${label} · ${formatMs(lastValue, { digits: 0, atLeast })}`
        }
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={cn('block overflow-visible', tone)}
      >
        <line
          x1={SPARK_GUTTER}
          x2={width}
          y1={4}
          y2={4}
          stroke="var(--line)"
          strokeWidth={1}
          data-slot="spark-top"
        />
        <line
          x1={SPARK_GUTTER}
          x2={width}
          y1={geometry.baseline}
          y2={geometry.baseline}
          stroke="var(--line-strong)"
          strokeWidth={1}
          data-slot="spark-axis"
        />
        <text
          x={SPARK_GUTTER - 6}
          y={geometry.baseline + 3}
          textAnchor="end"
          fontSize={10}
          className="fill-ink-subtle font-mono"
        >
          0
        </text>
        <text
          x={SPARK_GUTTER - 6}
          y={7}
          textAnchor="end"
          fontSize={10}
          className="fill-ink-subtle font-mono"
        >
          {formatNumber(geometry.top, 0)}
        </text>
        {geometry.usualY != null && (
          <line
            x1={SPARK_GUTTER}
            x2={width}
            y1={geometry.usualY}
            y2={geometry.usualY}
            stroke="var(--ink-subtle)"
            strokeWidth={1}
            strokeDasharray="2 3"
            data-slot="spark-usual"
          />
        )}
        {geometry.band && (
          <path
            d={geometry.band}
            fill="currentColor"
            fillOpacity={stale ? 0.08 : 0.16}
            stroke="none"
            data-slot="spark-band"
          />
        )}
        <path
          d={geometry.line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={stale ? 0.5 : 1}
          data-slot="spark-line"
        />
        {geometry.losses.map((x, i) => (
          <rect
            key={i}
            x={x - 1}
            y={geometry.baseline + 3}
            width={2}
            height={SPARK_LOSS_ROW - 3}
            fill="var(--degraded)"
            data-slot="spark-loss"
          />
        ))}
        {geometry.last && (
          <circle
            cx={geometry.last.x}
            cy={geometry.last.y}
            r={3.2}
            fill="currentColor"
            stroke="var(--card)"
            strokeWidth={2}
            data-slot="spark-last"
          />
        )}
      </svg>
      <div className="text-data-sm text-ink-subtle mt-1 flex justify-between gap-3 font-mono">
        <span>{m.live_spark_start({ seconds: String(SERIES_WINDOW_MS / 1000) })}</span>
        {usual != null && (
          <span className="text-center">
            {m.live_spark_usual({ ping: formatMs(usual, { digits: 0, atLeast }) })}
          </span>
        )}
        <span>{m.live_spark_now()}</span>
      </div>
    </div>
  )
}

export { Sparkline, type SparklineProps }

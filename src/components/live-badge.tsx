import { useBeat } from '@/hooks/use-beat'
import { liveStateLabel, type LiveState } from '@/lib/live-state'
import { cn } from '@/lib/utils'

const badgeTone: Record<LiveState, string> = {
  live: 'rounded-full bg-signal-soft pr-2.5 pl-1.5 text-signal',
  measuring: '',
  idle: '',
  stale: 'rounded-full border border-dashed border-line-strong pr-2.5 pl-1.5 text-ink-subtle',
}

const ring: Record<LiveState, { opacity: number; dash?: string }> = {
  live: { opacity: 0.55 },
  measuring: { opacity: 0.55, dash: '5 4' },
  idle: { opacity: 0.35 },
  stale: { opacity: 0.8, dash: '2 2' },
}

export function LiveOrb({
  state,
  beat = 0,
  className,
}: {
  state: LiveState
  beat?: number
  className?: string
}) {
  const hollow = state === 'idle'

  return (
    <span
      aria-hidden="true"
      data-slot="live-orb"
      data-state={state}
      className={cn('inline-flex h-3 w-5 shrink-0', className)}
    >
      <svg viewBox="0 0 20 12" width={20} height={12} className="block overflow-visible">
        <ellipse
          cx={10}
          cy={6}
          rx={8.6}
          ry={3.1}
          transform="rotate(-18 10 6)"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.3}
          strokeDasharray={ring[state].dash}
          opacity={ring[state].opacity}
        />
        {state === 'live' && beat > 0 && (
          <ellipse
            key={beat}
            data-slot="live-pulse"
            cx={10}
            cy={6}
            rx={8.6}
            ry={3.1}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.3}
            className="animate-orbit-pulse origin-center opacity-0 [transform-box:fill-box] motion-reduce:hidden"
          />
        )}
        <circle
          cx={10}
          cy={6}
          r={3.4}
          fill={hollow ? 'none' : 'currentColor'}
          stroke={hollow ? 'currentColor' : undefined}
          strokeWidth={hollow ? 1.3 : undefined}
        />
      </svg>
    </span>
  )
}

export function LiveBadge({
  state,
  label,
  sample,
  className,
}: {
  state: LiveState
  label?: string
  sample?: unknown
  className?: string
}) {
  const beat = useBeat(sample)

  return (
    <span
      role="status"
      data-slot="live-badge"
      data-state={state}
      className={cn(
        'text-label text-muted-foreground inline-flex h-[22px] items-center gap-1.5 font-semibold whitespace-nowrap [font-stretch:92%]',
        badgeTone[state],
        className
      )}
    >
      <LiveOrb state={state} beat={beat} />
      <span>{label ?? liveStateLabel(state)}</span>
    </span>
  )
}

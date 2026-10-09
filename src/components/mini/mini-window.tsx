import { RiArrowDownSLine, RiArrowUpSLine, RiCloseLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import { liveStateLabel } from '@/lib/live-state'
import {
  badgeState,
  faultText,
  liveTitle,
  matchElapsed,
  readingFacts,
  readingValue,
  secondsSince,
  type MiniSample,
} from '@/lib/mini'
import { cn } from '@/lib/utils'
import type { LiveStatus } from '@/types/backend'
import { LiveBadge } from '@/components/live-badge'
import { LogoMark } from '@/components/logo-mark'
import { MiniSparkline } from '@/components/mini/mini-sparkline'
import { SeverityGlyph } from '@/components/status/severity-glyph'
import { severityText } from '@/components/status/severity-color'
import { StatusPill } from '@/components/status/status-pill'
import { Button } from '@/components/ui/button'

export type MiniWindowProps = {
  status: LiveStatus | null
  samples: MiniSample[]
  sample?: unknown
  now: number
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onClose: () => void
}

function badgeLabel(status: LiveStatus | null, now: number): string {
  const state = badgeState(status)
  if (!status) return m.mini_no_match()
  if (status.state === 'waiting') return m.mini_waiting()
  if (status.state === 'frozen') {
    const seconds = secondsSince(status.lastSampleAt, now)
    return seconds == null
      ? liveStateLabel(state)
      : `${liveStateLabel(state)} · ${m.mini_ago({ seconds })}`
  }
  const elapsed = status.state === 'live' ? matchElapsed(status, now) : null
  return elapsed ? `${liveStateLabel(state)} · ${elapsed}` : liveStateLabel(state)
}

function frozenText(status: LiveStatus, now: number): string {
  if (status.frozenReason === 'capture_service') return m.mini_frozen_service()
  return m.mini_frozen_samples({ seconds: secondsSince(status.lastSampleAt, now) ?? 0 })
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-ink-subtle"
    >
      {children}
    </Button>
  )
}

export function MiniWindow({
  status,
  samples,
  sample,
  now,
  collapsed,
  onCollapsedChange,
  onClose,
}: MiniWindowProps) {
  const state = badgeState(status)
  const live = status?.state === 'live'
  const frozen = status?.state === 'frozen'
  const primary = status?.primary ?? null
  const value = readingValue(primary)
  const stale = frozen || (primary != null && !primary.fresh)
  const label = badgeLabel(status, now)

  if (collapsed) {
    return (
      <div
        data-slot="mini-window"
        data-collapsed=""
        data-tauri-drag-region
        aria-label={m.mini_window_label()}
        className="bg-surface-raised flex h-screen items-center gap-2.5 overflow-hidden pr-1.5 pl-2 select-none"
      >
        <LiveBadge
          state={state}
          label={value ? `${value}\u00a0ms` : label}
          sample={live ? sample : undefined}
        />
        {live && <StatusPill status={status.status} size="sm" />}
        <span data-tauri-drag-region className="flex-1 self-stretch" />
        <IconButton label={m.mini_expand()} onClick={() => onCollapsedChange(false)}>
          <RiArrowUpSLine />
        </IconButton>
      </div>
    )
  }

  const fault = live ? faultText(status) : null
  const facts = live && primary ? readingFacts(primary) : []

  return (
    <section
      data-slot="mini-window"
      aria-label={m.mini_window_label()}
      className="bg-surface-raised flex h-screen flex-col gap-2.5 overflow-hidden px-3.5 pb-3 select-none"
    >
      <div data-tauri-drag-region className="-mr-1.5 flex h-[34px] shrink-0 items-center gap-2">
        <LogoMark aria-hidden="true" className="text-foreground size-[18px]" />
        <span
          data-tauri-drag-region
          className="text-label text-foreground min-w-0 flex-1 truncate font-semibold"
        >
          {liveTitle(status)}
        </span>
        {!frozen && (
          <IconButton label={m.mini_collapse()} onClick={() => onCollapsedChange(true)}>
            <RiArrowDownSLine />
          </IconButton>
        )}
        <IconButton label={m.mini_close()} onClick={onClose}>
          <RiCloseLine />
        </IconButton>
      </div>

      <div data-tauri-drag-region className="flex flex-wrap items-baseline gap-1.5">
        <span
          data-slot="mini-value"
          className={cn(
            'text-foreground font-mono text-[40px] leading-10 font-medium tracking-[-0.03em] tabular-nums',
            stale &&
              'text-ink-subtle decoration-line-strong underline decoration-dashed decoration-2 underline-offset-8'
          )}
        >
          {value ?? '—'}
        </span>
        {value && <span className="text-muted-foreground font-mono text-sm font-medium">ms</span>}
        <span className="ml-auto flex items-center gap-2">
          {live && <StatusPill status={status.status} size="sm" />}
          <LiveBadge state={state} label={label} sample={live ? sample : undefined} />
        </span>
      </div>

      {(live || status?.state === 'measuring') && (
        <MiniSparkline
          samples={samples}
          usualMs={primary?.usual.medianMs}
          live={live}
          label={m.mini_sparkline_label()}
          className="text-foreground"
        />
      )}

      {status && frozen && (
        <p className="text-data-sm text-muted-foreground font-mono">{frozenText(status, now)}</p>
      )}
      {status && fault && (
        <p
          data-slot="mini-fault"
          className={cn('text-ui flex items-center gap-1.5', severityText[status.status])}
        >
          <SeverityGlyph status={status.status} size={9} />
          {fault}
        </p>
      )}
      {!fault && facts.length > 0 && (
        <p data-slot="mini-facts" className="text-data-sm text-muted-foreground font-mono">
          {facts.join(' · ')}
        </p>
      )}
    </section>
  )
}

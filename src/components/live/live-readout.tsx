import * as m from '@/paraglide/messages'
import type { LiveReading, LiveRegion } from '@/types/backend'
import { formatMs, formatPercent } from '@/lib/format'
import {
  readingBasis,
  readingValue,
  referenceText,
  seriesWorst,
  type SeriesPoint,
} from '@/lib/live'
import { cn } from '@/lib/utils'
import { Fact, FactRow } from '@/components/fact-row'
import { Panel } from '@/components/panel'
import { Sparkline } from '@/components/live/sparkline'
import { SeverityGlyph } from '@/components/status/severity-glyph'
import { StatusPill } from '@/components/status/status-pill'

type LiveReadoutProps = {
  reading: LiveReading | null
  frozen?: boolean
  points: SeriesPoint[]
  end: number
  elapsed?: string | null
  age?: string | null
  region?: LiveRegion | null
  className?: string
}

function LiveReadout({
  reading,
  frozen = false,
  points,
  end,
  elapsed,
  age,
  region,
  className,
}: LiveReadoutProps) {
  const atLeast = reading?.atLeast ?? false
  const lossPct = reading?.lossPct ?? reading?.lossFloorPct ?? null
  const reference = reading ? referenceText(reading) : null
  const worst = seriesWorst(points)

  const action = frozen ? (
    <span className="text-label text-ink-subtle flex items-center gap-1.5 font-normal">
      <SeverityGlyph status="unmeasured" size={9} />
      {age ? m.live_frozen_since({ age }) : m.live_badge_stale()}
    </span>
  ) : (
    elapsed && (
      <span className="text-data-sm text-muted-foreground font-mono tabular-nums">{elapsed}</span>
    )
  )

  return (
    <Panel
      data-slot="live-readout"
      data-state={frozen ? 'frozen' : reading ? 'live' : 'measuring'}
      label={m.live_readout_label()}
      action={action}
      className={className}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-2">
          <p
            data-slot="live-value"
            className={cn(
              'text-readout-xl text-foreground font-mono whitespace-nowrap tabular-nums',
              frozen &&
                'text-ink-subtle decoration-line-strong underline decoration-dashed decoration-2 underline-offset-[10px]'
            )}
          >
            {readingValue(reading)}
          </p>
          <span className="text-body text-muted-foreground font-mono">ms</span>
          <div className="ml-auto flex flex-col items-end gap-0.5 self-center">
            <StatusPill status={frozen || !reading ? 'unmeasured' : reading.status} />
            {reference && (
              <span data-slot="live-reference" className="text-data-sm text-ink-subtle font-mono">
                {reference}
              </span>
            )}
          </div>
        </div>
        <p data-slot="live-basis" className="text-ui text-muted-foreground">
          {reading ? readingBasis(reading) : m.live_readout_pending()}
        </p>
        <FactRow className="border-t pt-3">
          <Fact label={m.matches_col_jitter()}>{formatMs(reading?.jitterMs, { digits: 1 })}</Fact>
          <Fact
            label={m.matches_col_loss()}
            detail={
              reading && reading.sent > 0
                ? m.live_loss_detail({ lost: String(reading.lost), sent: String(reading.sent) })
                : undefined
            }
          >
            {formatPercent(lossPct, { digits: 1 })}
          </Fact>
          <Fact label={m.match_worst()}>
            {worst != null && formatMs(worst, { digits: 0, atLeast })}
          </Fact>
        </FactRow>
        <Sparkline
          points={points}
          end={end}
          usual={reading?.usual.medianMs ?? reading?.traceMs ?? null}
          atLeast={atLeast}
          status={frozen ? 'unmeasured' : (reading?.status ?? 'unmeasured')}
          stale={frozen}
          label={m.live_spark_label()}
        />
        {region?.medianMs != null && (
          <p data-slot="region-estimate" className="text-label text-ink-subtle font-normal">
            {m.live_region_estimate({
              ping: formatMs(region.medianMs, { digits: 0 }),
              region: region.region ?? '—',
            })}
          </p>
        )}
      </div>
    </Panel>
  )
}

export { LiveReadout, type LiveReadoutProps }

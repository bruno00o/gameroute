import { useMemo } from 'react'

import * as m from '@/paraglide/messages'
import type { MeasuredFlow, SessionMatch, TracerouteWithHops } from '@/types/backend'
import { formatClock, formatElapsed, formatMs } from '@/lib/format'
import {
  flowServerLabel,
  formatFlowPing,
  formatLoss,
  matchMeasure,
  pingSourceNote,
  regionPingsText,
  severityRank,
  traceOf,
  traceTiming,
  traceTimingText,
} from '@/lib/matches'
import { cn } from '@/lib/utils'
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { StatusPill } from '@/components/status/status-pill'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type MatchTableProps = {
  matches: SessionMatch[]
  traceroutes: TracerouteWithHops[]
  sessionEndedAt: string | null
  gameName?: string
  detailed?: boolean
  selectedPeriodId?: number
  onSelect?: (match: SessionMatch) => void
  className?: string
}

function Measure({
  value,
  point,
  details,
}: {
  value: string
  point: string | null
  details: string[]
}) {
  const [label, ...more] = point ? [point, ...details] : details
  const note = 'text-label text-ink-subtle text-right font-sans font-normal whitespace-nowrap'

  return (
    <span className="inline-flex flex-col items-end">
      <span>{value}</span>
      {more.length > 0 ? (
        <Tooltip>
          <TooltipTrigger
            className={cn(
              note,
              'decoration-line-strong cursor-help underline decoration-dotted underline-offset-2'
            )}
          >
            {label}
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex flex-col gap-1 text-left">
            {more.map(detail => (
              <span key={detail}>{detail}</span>
            ))}
          </TooltipContent>
        </Tooltip>
      ) : (
        label && <span className={note}>{label}</span>
      )}
    </span>
  )
}

function MatchTable({
  matches,
  traceroutes,
  sessionEndedAt,
  gameName,
  detailed = false,
  selectedPeriodId,
  onSelect,
  className,
}: MatchTableProps) {
  const columns = useMemo<DataTableColumn<SessionMatch>[]>(() => {
    const point = (flow: MeasuredFlow) => pingSourceNote(flow, traceOf(flow, traceroutes)?.route)

    const timing = (flow: MeasuredFlow) => {
      if (flow.game) return null
      const when = traceTiming(flow, matches, sessionEndedAt)
      return when && traceTimingText(when)
    }

    const pingDetails = (match: SessionMatch) =>
      [timing(match), gameName ? regionPingsText(match, gameName) : null].filter(
        (detail): detail is string => detail != null
      )

    const voice = (match: SessionMatch) => {
      if (!match.voice) return null
      if (!match.voice.trace) {
        return <span className="text-muted-foreground font-sans">{m.matches_no_trace()}</span>
      }
      if (match.voice.trace.pingMs == null) return null
      const when = timing(match.voice)
      return (
        <Measure
          value={formatFlowPing(match.voice.trace)}
          point={point(match.voice)}
          details={when ? [when] : []}
        />
      )
    }

    return [
      { key: 'number', label: '#', mono: true, width: 36 },
      {
        key: 'startedAt',
        label: m.matches_col_start(),
        mono: true,
        render: match => formatClock(match.startedAt),
      },
      {
        key: 'durationSecs',
        label: m.matches_col_duration(),
        mono: true,
        align: 'end',
        render: match => formatElapsed(match.durationSecs),
      },
      {
        key: 'server',
        label: m.matches_col_server(),
        sortValue: match => flowServerLabel(match),
        render: match => (
          <span className="flex flex-col">
            <span>{flowServerLabel(match)}</span>
            {detailed && <span className="text-data-sm text-ink-subtle font-mono">{match.ip}</span>}
          </span>
        ),
      },
      {
        key: 'ping',
        label: m.matches_col_ping(),
        mono: true,
        align: 'end',
        sortValue: match => matchMeasure(match)?.pingMs,
        render: match =>
          matchMeasure(match)?.pingMs == null ? null : (
            <Measure
              value={formatFlowPing(matchMeasure(match))}
              point={point(match)}
              details={pingDetails(match)}
            />
          ),
      },
      {
        key: 'loss',
        label: m.matches_col_loss(),
        mono: true,
        align: 'end',
        sortValue: match => matchMeasure(match)?.lossPct,
        render: match => {
          const loss = matchMeasure(match)?.lossPct
          return loss == null ? null : formatLoss(loss)
        },
      },
      ...(detailed
        ? [
            {
              key: 'jitter',
              label: m.matches_col_jitter(),
              mono: true,
              align: 'end',
              sortValue: match => matchMeasure(match)?.jitterMs,
              render: match => {
                const jitter = matchMeasure(match)?.jitterMs
                return jitter == null ? null : formatMs(jitter)
              },
            } satisfies DataTableColumn<SessionMatch>,
          ]
        : []),
      {
        key: 'voice',
        label: m.matches_col_voice(),
        mono: true,
        align: 'end',
        sortValue: match => match.voice?.trace?.pingMs,
        render: voice,
      },
      {
        key: 'status',
        label: m.matches_col_status(),
        sortValue: match => severityRank(match.status),
        render: match => <StatusPill status={match.status} size="sm" />,
      },
    ]
  }, [matches, traceroutes, sessionEndedAt, gameName, detailed])

  return (
    <DataTable
      className={className}
      columns={columns}
      rows={matches}
      getRowId={match => String(match.periodId)}
      defaultSort={{ key: 'number', dir: 'asc' }}
      selectedKey={selectedPeriodId}
      onRowClick={onSelect}
    />
  )
}

export { MatchTable, type MatchTableProps }

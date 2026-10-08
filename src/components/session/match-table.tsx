import { useMemo } from 'react'

import * as m from '@/paraglide/messages'
import type { MeasuredFlow, SessionMatch, TracerouteWithHops } from '@/types/backend'
import { formatClock, formatElapsed, formatMs } from '@/lib/format'
import {
  flowProvenance,
  flowServerLabel,
  formatFlowPing,
  formatLoss,
  matchMeasure,
  severityRank,
} from '@/lib/matches'
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { StatusPill } from '@/components/status/status-pill'

type MatchTableProps = {
  matches: SessionMatch[]
  traceroutes: TracerouteWithHops[]
  sessionEndedAt: string | null
  detailed?: boolean
  selectedPeriodId?: number
  onSelect?: (match: SessionMatch) => void
  className?: string
}

function Measure({ value, notes }: { value: string; notes: string[] }) {
  return (
    <span className="inline-flex flex-col items-end">
      <span>{value}</span>
      {notes.length > 0 && (
        <span className="text-label text-ink-subtle max-w-[26ch] text-right font-sans font-normal whitespace-normal">
          {notes.join(' · ')}
        </span>
      )}
    </span>
  )
}

function MatchTable({
  matches,
  traceroutes,
  sessionEndedAt,
  detailed = false,
  selectedPeriodId,
  onSelect,
  className,
}: MatchTableProps) {
  const columns = useMemo<DataTableColumn<SessionMatch>[]>(() => {
    const provenance = (flow: MeasuredFlow) =>
      flowProvenance(flow, matches, traceroutes, sessionEndedAt, { withOffset: detailed })

    const voice = (match: SessionMatch) => {
      if (!match.voice) return null
      if (!match.voice.trace) {
        return <span className="text-muted-foreground font-sans">{m.matches_no_trace()}</span>
      }
      if (match.voice.trace.pingMs == null) return null
      return <Measure value={formatFlowPing(match.voice.trace)} notes={provenance(match.voice)} />
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
            <Measure value={formatFlowPing(matchMeasure(match))} notes={provenance(match)} />
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
  }, [matches, traceroutes, sessionEndedAt, detailed])

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

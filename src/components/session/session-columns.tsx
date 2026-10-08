import * as m from '@/paraglide/messages'
import type { SessionListItem } from '@/types/backend'
import {
  computeDurationSecs,
  formatDayTime,
  formatDuration,
  formatMs,
  formatNumber,
} from '@/lib/format'
import type { DataTableColumn } from '@/components/data-table'
import { StatusPill } from '@/components/status/status-pill'

const NBSP = ' '

export function sessionColumns({
  sortable,
}: { sortable?: boolean } = {}): DataTableColumn<SessionListItem>[] {
  return [
    {
      key: 'gameName',
      label: m.sessions_col_game(),
      sortable,
      render: session => <span className="font-medium">{session.gameName}</span>,
    },
    {
      key: 'startedAt',
      label: m.sessions_col_started(),
      sortable,
      render: session => (
        <span className="whitespace-nowrap">{formatDayTime(session.startedAt)}</span>
      ),
    },
    {
      key: 'duration',
      label: m.sessions_col_duration(),
      align: 'end',
      mono: true,
      sortable,
      render: sessionDuration,
    },
    {
      key: 'matchCount',
      label: m.sessions_col_matches(),
      align: 'end',
      mono: true,
      sortable,
      render: session => formatNumber(session.matchCount),
    },
    {
      key: 'medianPingMs',
      label: m.sessions_col_ping(),
      align: 'end',
      mono: true,
      sortable,
      render: session =>
        session.medianPingMs == null ? null : (
          <span
            className="whitespace-nowrap"
            title={session.medianPingAtLeast ? m.route_total_up_to() : undefined}
          >
            {formatMs(session.medianPingMs, { digits: 0, atLeast: session.medianPingAtLeast })}
          </span>
        ),
    },
    {
      key: 'status',
      label: m.sessions_col_quality(),
      sortable,
      render: session => session.status && <StatusPill status={session.status} size="sm" />,
    },
  ]
}

function sessionDuration(session: SessionListItem) {
  const qualifier =
    session.endedAt === null
      ? m.sessions_duration_live()
      : session.endEstimated
        ? m.sessions_duration_estimated()
        : null

  return (
    <span className="whitespace-nowrap">
      {session.endEstimated && `≈${NBSP}`}
      {formatDuration(computeDurationSecs(session.startedAt, session.endedAt))}
      {qualifier && (
        <span className="text-label text-muted-foreground font-sans font-normal">
          {` · ${qualifier}`}
        </span>
      )}
    </span>
  )
}

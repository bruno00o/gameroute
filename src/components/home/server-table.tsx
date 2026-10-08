import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'
import type { ServerIncident, ServerSummaryItem } from '@/types/backend'
import { formatDay, formatNumber } from '@/lib/format'
import { formatLoss } from '@/lib/matches'
import {
  formatServerPing,
  formatServerUsual,
  incidentCause,
  incidentSource,
  serverName,
} from '@/lib/server-summary'
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { StatusPill } from '@/components/status/status-pill'

const PAGE_SIZE = 10

type ServerTableProps = {
  servers: ServerSummaryItem[]
  days: number
  usualMinSamples: number
  loading?: boolean
  showGame?: boolean
}

function serverId(server: ServerSummaryItem): string {
  return [server.gameName, server.asn, server.operator, server.city, server.ips.join(',')].join('|')
}

function upToLastHop(server: ServerSummaryItem): string | undefined {
  return server.basis && !server.basis.atDestination ? m.route_total_up_to() : undefined
}

function ServerTable({
  servers,
  days,
  usualMinSamples,
  loading = false,
  showGame = true,
}: ServerTableProps) {
  const columns = useMemo<DataTableColumn<ServerSummaryItem>[]>(
    () => [
      {
        key: 'server',
        label: m.matches_col_server(),
        sortable: false,
        render: server => (
          <span className="flex min-w-0 flex-col">
            {showGame ? (
              <>
                <span className="font-medium">{server.gameName}</span>
                <span className="text-label text-muted-foreground font-normal">
                  {serverName(server)}
                </span>
              </>
            ) : (
              <span className="font-medium">{serverName(server)}</span>
            )}
          </span>
        ),
      },
      {
        key: 'matchCount',
        label: m.sessions_col_matches(),
        align: 'end',
        mono: true,
        sortable: false,
        render: server => formatNumber(server.matchCount),
      },
      {
        key: 'recent',
        label: m.sessions_col_ping(),
        align: 'end',
        mono: true,
        sortable: false,
        render: server => {
          const ping = formatServerPing(server)
          return (
            ping && (
              <span className="whitespace-nowrap" title={upToLastHop(server)}>
                {ping}
              </span>
            )
          )
        },
      },
      {
        key: 'usual',
        label: m.home_col_usual(),
        align: 'end',
        mono: true,
        sortable: false,
        render: server => {
          const usual = formatServerUsual(server)
          return usual ? (
            <span className="whitespace-nowrap" title={upToLastHop(server)}>
              {usual}
            </span>
          ) : (
            <span className="text-label text-muted-foreground font-sans font-normal">
              {m.home_usual_pending({
                count: String(server.usual.sampleCount),
                min: String(usualMinSamples),
              })}
            </span>
          )
        },
      },
      {
        key: 'loss',
        label: m.matches_col_loss(),
        align: 'end',
        mono: true,
        sortable: false,
        render: server => server.recent && formatLoss(server.recent.lossPct),
      },
      {
        key: 'status',
        label: m.sessions_col_quality(),
        sortable: false,
        render: server =>
          server.status ? (
            <StatusPill status={server.status} size="sm" />
          ) : (
            <span className="text-label text-muted-foreground font-normal">
              {m.home_not_played({ count: String(days) })}
            </span>
          ),
      },
      {
        key: 'lastIncident',
        label: m.home_col_incident(),
        sortable: false,
        render: server => server.lastIncident && <IncidentCell incident={server.lastIncident} />,
      },
    ],
    [days, usualMinSamples, showGame]
  )

  return (
    <DataTable
      columns={columns}
      rows={servers}
      getRowId={serverId}
      pageSize={PAGE_SIZE}
      loading={loading}
    />
  )
}

function IncidentCell({ incident }: { incident: ServerIncident }) {
  const number = String(incident.matchNumber)

  return (
    <span data-slot="server-incident" className="flex min-w-0 flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <StatusPill status={incident.status} size="sm" />
        <Link
          to="/sessions/$id/matches/$n"
          params={{ id: String(incident.sessionId), n: number }}
          className="text-foreground decoration-line-strong hover:decoration-foreground whitespace-nowrap underline underline-offset-4"
        >
          {m.home_incident_match({ date: formatDay(incident.startedAt), number })}
        </Link>
      </span>
      <span className="text-label text-ink-subtle font-normal">
        {`${incidentCause(incident)} · ${incidentSource(incident)}`}
      </span>
    </span>
  )
}

export { ServerTable, type ServerTableProps }

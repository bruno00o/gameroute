import type { ReportMatch, ReportPayload } from '@gameroute/shared'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  formatMatchStart,
  formatMs,
  formatPct,
  REASON_LABELS,
  STATUS_LABELS,
  sourceLabel,
} from '@/lib/report-text'
import { m } from '@/paraglide/messages'
import { SeverityGlyph } from './SeverityGlyph'

const HEAD = 'text-label text-muted-foreground'
const NUMBER = 'text-right font-mono tabular-nums'

function Missing() {
  return <span className="font-sans text-subtle-foreground">{m.report_not_measured()}</span>
}

function Ping({ match, value }: { match: ReportMatch; value: number | null }) {
  return value == null ? <Missing /> : formatMs(value, match.pingAtLeast)
}

export function MatchTable({ payload, label }: { payload: ReportPayload; label: string }) {
  return (
    <Table aria-label={label} className="text-ui">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>{m.report_col_match()}</TableHead>
          <TableHead className={HEAD}>{m.report_col_start()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_duration()}</TableHead>
          <TableHead className={HEAD}>{m.report_col_status()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_ping()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_p95()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_usual()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_loss()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_jitter()}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payload.matches.map(match => (
          <TableRow key={match.number} className="align-top">
            <TableCell className="py-3 font-mono tabular-nums">{match.number}</TableCell>
            <TableCell className="py-3 whitespace-nowrap">
              {formatMatchStart(match.startedAt, payload.exactTimes)}
            </TableCell>
            <TableCell className={`py-3 ${NUMBER}`}>
              {m.report_duration_min({ minutes: Math.round(match.durationSecs / 60) })}
            </TableCell>
            <TableCell className="py-3">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <SeverityGlyph status={match.status} size={9} />
                {STATUS_LABELS[match.status]()}
              </span>
              {match.reason && (
                <span className="block text-label font-normal text-muted-foreground">
                  {REASON_LABELS[match.reason]()}
                </span>
              )}
            </TableCell>
            <TableCell className={`py-3 ${NUMBER}`}>
              <span className="block whitespace-nowrap">
                <Ping match={match} value={match.pingMedianMs} />
              </span>
              <span className="block font-sans text-label font-normal text-subtle-foreground">
                {sourceLabel(match)}
              </span>
            </TableCell>
            <TableCell className={`py-3 whitespace-nowrap ${NUMBER}`}>
              <Ping match={match} value={match.pingP95Ms} />
            </TableCell>
            <TableCell className={`py-3 whitespace-nowrap ${NUMBER}`}>
              {match.usualPingMs == null ? <Missing /> : formatMs(match.usualPingMs)}
            </TableCell>
            <TableCell className={`py-3 whitespace-nowrap ${NUMBER}`}>
              {match.lossPct == null ? <Missing /> : formatPct(match.lossPct)}
            </TableCell>
            <TableCell className={`py-3 whitespace-nowrap ${NUMBER}`}>
              {match.jitterMs == null ? <Missing /> : formatMs(match.jitterMs)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

import type { ReportHop, ReportRoute } from '@gameroute/shared'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatMs, formatPct, STATUS_LABELS, ZONE_LABELS } from '@/lib/report-text'
import { m } from '@/paraglide/messages'
import { ZONE_BG } from './RouteStrip'
import { SeverityGlyph } from './SeverityGlyph'

const HEAD = 'text-label text-muted-foreground'

function operatorName(route: ReportRoute, hop: ReportHop) {
  return route.segments.find(
    segment => segment.firstHop <= hop.number && hop.number <= segment.lastHop
  )?.name
}

export function HopTable({ route, label }: { route: ReportRoute; label: string }) {
  return (
    <Table aria-label={label} className="text-ui">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={HEAD}>{m.report_col_hop()}</TableHead>
          <TableHead className={HEAD}>{m.report_col_zone()}</TableHead>
          <TableHead className={HEAD}>{m.report_col_operator()}</TableHead>
          <TableHead className={HEAD}>{m.report_col_address()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_latency()}</TableHead>
          <TableHead className={`${HEAD} text-right`}>{m.report_col_loss()}</TableHead>
          <TableHead className={HEAD}>{m.report_col_status()}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {route.hops.map(hop => (
          <TableRow key={hop.number} data-silent={hop.silent || undefined}>
            <TableCell className="font-mono tabular-nums">{hop.number}</TableCell>
            <TableCell>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`block size-2.5 ${ZONE_BG[hop.zone]}`} />
                {ZONE_LABELS[hop.zone]()}
              </span>
            </TableCell>
            {hop.silent ? (
              <TableCell colSpan={4}>
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <span aria-hidden="true" className="hatch block h-2.5 w-10" />
                  {m.report_hop_silent()}
                </span>
              </TableCell>
            ) : (
              <>
                <TableCell>
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {operatorName(route, hop) && (
                      <span className="font-semibold">{operatorName(route, hop)}</span>
                    )}
                    {hop.asn != null && (
                      <span className="font-mono text-[12px] text-subtle-foreground">
                        AS{hop.asn}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-[12px]">
                  {hop.ip ?? (
                    <span className="font-sans text-subtle-foreground">
                      {hop.zone === 'home' ? m.report_hop_local() : ''}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {hop.rttMs == null ? '' : formatMs(hop.rttMs)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {hop.lossPct == null ? '' : formatPct(hop.lossPct)}
                </TableCell>
              </>
            )}
            <TableCell>
              {hop.status && (
                <span className="inline-flex items-center gap-1.5">
                  <SeverityGlyph status={hop.status} size={9} />
                  {STATUS_LABELS[hop.status]()}
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

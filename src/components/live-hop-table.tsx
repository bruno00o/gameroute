import * as m from '@/paraglide/messages'
import type { TracerouteHopEvent } from '@/types/backend'
import { formatMs } from '@/lib/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SilentHop } from '@/components/status/silent-hop'

export function LiveHopTable({
  hops,
  advancedMode = true,
}: {
  hops: TracerouteHopEvent[]
  advancedMode?: boolean
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">{m.trace_hop_number()}</TableHead>
          <TableHead>{m.trace_hop_ip()}</TableHead>
          {advancedMode && (
            <TableHead className="hidden sm:table-cell">{m.trace_hop_hostname()}</TableHead>
          )}
          <TableHead className="text-right">
            {advancedMode ? m.trace_hop_latency() : m.simple_latency()}
          </TableHead>
          <TableHead className="text-right">{m.trace_hop_status()}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hops.map((hop, i) => (
          <TableRow key={`${hop.hopNumber}-${i}`}>
            <TableCell className="tabular-nums">{hop.hopNumber}</TableCell>
            <TableCell className="font-mono">
              {hop.ip ? hop.ip : <span className="text-muted-foreground">*</span>}
            </TableCell>
            {advancedMode && (
              <TableCell className="hidden max-w-48 truncate sm:table-cell">
                {hop.hostname ?? <span className="text-muted-foreground">-</span>}
              </TableCell>
            )}
            <TableCell className="text-right font-mono tabular-nums">
              {hop.rttMs != null ? (
                formatMs(hop.rttMs)
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell className="text-right">{hop.timeout ? <SilentHop /> : null}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

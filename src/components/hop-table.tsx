import { RiAlertLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { DbHop, ResolvedIpData } from '@/types/backend'
import { latencyColor, formatMs, formatLoss } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'

export function HopTable({
  hops,
  asnData,
  problemHopIndex,
  targetIp,
}: {
  hops: DbHop[]
  asnData?: Map<string, ResolvedIpData>
  problemHopIndex?: number | null
  targetIp?: string
}) {
  // Check if destination is already in the hop list
  const destinationReached = targetIp
    ? hops.some(h => h.ip === targetIp)
    : true

  // Find last responding hop number for gap display
  const lastRespondingHop = hops.reduce(
    (max, h) => (h.ip ? Math.max(max, h.hopNumber) : max),
    0,
  )

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">{m.session_hop_number()}</TableHead>
          <TableHead>{m.session_hop_ip()}</TableHead>
          <TableHead className="hidden sm:table-cell">{m.session_hop_hostname()}</TableHead>
          <TableHead className="text-right">{m.session_hop_latency()}</TableHead>
          <TableHead className="text-right">{m.session_hop_loss()}</TableHead>
          <TableHead className="hidden text-right md:table-cell">Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hops.map(hop => {
          const isProblem = hop.isProblemHop || hop.hopNumber === problemHopIndex
          const isDestination = hop.ip === targetIp
          const resolved = hop.ip ? asnData?.get(hop.ip) : undefined
          const asnLabel = resolved
            ? [resolved.asnInfo.isp, resolved.geo.city, resolved.geo.country]
                .filter(Boolean)
                .join(', ')
            : null

          return (
            <TableRow key={hop.id} className={cn(isProblem && 'bg-destructive/5')}>
              <TableCell className="tabular-nums">
                <span className="flex items-center gap-1">
                  {isDestination ? '→' : hop.hopNumber}
                  {isProblem && <RiAlertLine className="text-destructive size-3" />}
                </span>
              </TableCell>
              <TableCell className="font-mono">
                {hop.ip ? (
                  asnLabel ? (
                    <Tooltip>
                      <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
                        {hop.ip}
                      </TooltipTrigger>
                      <TooltipContent>{asnLabel}</TooltipContent>
                    </Tooltip>
                  ) : (
                    hop.ip
                  )
                ) : (
                  <span className="text-muted-foreground">*</span>
                )}
              </TableCell>
              <TableCell className="hidden max-w-48 truncate sm:table-cell">
                {hop.hostname ?? <span className="text-muted-foreground">-</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {hop.latencyAvg != null ? (
                  <Tooltip>
                    <TooltipTrigger className={cn('cursor-default', latencyColor(hop.latencyAvg))}>
                      {formatMs(hop.latencyAvg)}ms
                    </TooltipTrigger>
                    <TooltipContent>
                      min {formatMs(hop.latencyMin)} / avg {formatMs(hop.latencyAvg)} / max{' '}
                      {formatMs(hop.latencyMax)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-muted-foreground">{m.session_hop_timeout()}</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {hop.packetLoss != null ? (
                  <span
                    className={cn(
                      hop.packetLoss > 5 && 'text-destructive',
                      hop.packetLoss > 0 && hop.packetLoss <= 5 && 'text-amber-500',
                    )}
                  >
                    {formatLoss(hop.packetLoss)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                {hop.source ? (
                  <Badge variant="outline" className="text-xs font-normal">
                    {hop.source}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">ICMP</span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
        {!destinationReached && targetIp && (
          <>
            {lastRespondingHop > 0 && (
              <TableRow>
                <TableCell className="text-muted-foreground tabular-nums">…</TableCell>
                <TableCell colSpan={5}>
                  <span className="text-muted-foreground text-xs italic">
                    {m.session_hop_unknown_hops()}
                  </span>
                </TableCell>
              </TableRow>
            )}
            <TableRow className="bg-muted/30">
              <TableCell className="tabular-nums font-medium">→</TableCell>
              <TableCell className="font-mono">
                {(() => {
                  const destResolved = asnData?.get(targetIp)
                  const destLabel = destResolved
                    ? [destResolved.asnInfo.isp, destResolved.geo.city, destResolved.geo.country]
                        .filter(Boolean)
                        .join(', ')
                    : null
                  return destLabel ? (
                    <Tooltip>
                      <TooltipTrigger className="cursor-default underline decoration-dotted underline-offset-2">
                        {targetIp}
                      </TooltipTrigger>
                      <TooltipContent>{destLabel}</TooltipContent>
                    </Tooltip>
                  ) : (
                    targetIp
                  )
                })()}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <span className="text-muted-foreground">-</span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-muted-foreground text-xs">
                  {m.session_hop_unreachable()}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-muted-foreground">-</span>
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <span className="text-muted-foreground">-</span>
              </TableCell>
            </TableRow>
          </>
        )}
      </TableBody>
    </Table>
  )
}

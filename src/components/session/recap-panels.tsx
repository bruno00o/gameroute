import * as m from '@/paraglide/messages'
import type { MatchRecap, OperatorRoute, SessionMatch } from '@/types/backend'
import { formatDuration, formatMs } from '@/lib/format'
import { formatLoss, formatUsualPing, matchMeasure, severityLabel } from '@/lib/matches'
import {
  formatAt,
  incidentBasisNote,
  incidentSecs,
  incidentValues,
  incidentWhere,
  pointLabel,
  pointVolume,
  primaryPoint,
} from '@/lib/recap'
import { formatRouteMs } from '@/lib/route'
import { cn } from '@/lib/utils'
import { Fact, FactRow } from '@/components/fact-row'
import { Panel } from '@/components/panel'
import { MatchTimeline } from '@/components/session/match-timeline'
import { SeverityGlyph } from '@/components/status/severity-glyph'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function IncidentList({ recap, className }: { recap: MatchRecap; className?: string }) {
  if (recap.incidents.length === 0) {
    return (
      <p className={cn('text-ui text-muted-foreground', className)}>{m.recap_incidents_none()}</p>
    )
  }

  return (
    <ol aria-label={m.recap_incidents_label()} className={cn('flex flex-col', className)}>
      {recap.incidents.map(incident => {
        const where = incidentWhere(incident)
        const values = incidentValues(incident)
        const basis = incidentBasisNote(incident.basis)
        return (
          <li
            key={incident.id}
            data-status={incident.status}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-t py-2 first:border-t-0 first:pt-0"
          >
            <span className="text-ui text-foreground flex items-center gap-1.5 font-semibold">
              <SeverityGlyph status={incident.status} size={10} />
              {severityLabel(incident.status)}
            </span>
            <span className="text-data-sm text-foreground font-mono tabular-nums">
              {m.recap_incident_range({
                from: formatAt(recap, incident.startedAt),
                to: formatAt(recap, incident.endedAt ?? recap.endedAt),
                duration: formatDuration(incidentSecs(incident, recap)),
              })}
            </span>
            {where && <span className="text-ui text-muted-foreground">{where}</span>}
            {values && (
              <span className="text-data-sm text-muted-foreground font-mono tabular-nums">
                {values}
              </span>
            )}
            {basis && <span className="text-label text-ink-subtle">{basis}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function RecapTimelinePanel({ recap, className }: { recap: MatchRecap; className?: string }) {
  const count = recap.incidents.length
  const title =
    count === 0
      ? undefined
      : count === 1
        ? m.recap_incidents_one()
        : m.recap_incidents_other({ count: String(count) })

  return (
    <Panel
      label={m.recap_timeline_label({ seconds: String(recap.bucketSecs) })}
      title={title}
      className={className}
    >
      <MatchTimeline
        cells={recap.cells}
        bucketSecs={recap.bucketSecs}
        durationSecs={recap.durationSecs}
      />
      <IncidentList recap={recap} className="mt-4" />
    </Panel>
  )
}

function RecapFacts({
  recap,
  match,
  route,
}: {
  recap: MatchRecap
  match: SessionMatch
  route?: OperatorRoute | null
}) {
  const point = primaryPoint(recap)
  if (!point) return null

  const measure = point.point === 'game' && match.game ? matchMeasure(match) : null
  const usual = measure && formatUsualPing(measure)
  const lossPoint = point.lossPct != null ? point : recap.points.find(p => p.lossPct != null)

  return (
    <FactRow className="gap-x-10">
      <Fact
        label={m.recap_kpi_ping()}
        detail={[pointLabel(point, route), usual && m.recap_usual({ usual })]
          .filter(Boolean)
          .join(', ')}
      >
        {point.pingMs != null && formatRouteMs(point.pingMs, point.atLeast)}
      </Fact>
      <Fact
        label={m.recap_kpi_jitter()}
        detail={
          point.jitterPeak
            ? m.recap_jitter_peak({
                value: formatMs(point.jitterPeak.value),
                at: formatAt(recap, point.jitterPeak.at),
              })
            : undefined
        }
      >
        {point.jitterMs != null && formatMs(point.jitterMs)}
      </Fact>
      <Fact label={m.recap_kpi_loss()} detail={lossPoint && pointVolume(lossPoint)}>
        {lossPoint?.lossPct != null && formatLoss(lossPoint.lossPct)}
      </Fact>
      <Fact
        label={m.match_worst()}
        detail={point.worst ? m.recap_worst_at({ at: formatAt(recap, point.worst.at) }) : undefined}
      >
        {point.worst && formatRouteMs(point.worst.value, point.atLeast)}
      </Fact>
    </FactRow>
  )
}

function RecapPointsPanel({
  recap,
  route,
  context,
  className,
}: {
  recap: MatchRecap
  route?: OperatorRoute | null
  context?: string | null
  className?: string
}) {
  return (
    <Panel
      tone="sunken"
      label={m.recap_measured_label()}
      footer={m.recap_measured_note()}
      className={className}
      flush
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{m.recap_col_point()}</TableHead>
            <TableHead className="text-right">{m.matches_col_ping()}</TableHead>
            <TableHead className="text-right">{m.matches_col_jitter()}</TableHead>
            <TableHead className="text-right">{m.matches_col_loss()}</TableHead>
            <TableHead className="text-right">{m.recap_col_volume()}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recap.points.map(point => (
            <TableRow key={point.point} data-point={point.point}>
              <TableCell>{pointLabel(point, route)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {point.pingMs == null ? '—' : formatRouteMs(point.pingMs, point.atLeast)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {point.jitterMs == null ? '—' : formatMs(point.jitterMs)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {point.lossPct == null ? '—' : formatLoss(point.lossPct)}
              </TableCell>
              <TableCell className="text-muted-foreground text-right font-mono tabular-nums">
                {pointVolume(point) ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {context && <p className="text-label text-muted-foreground px-4 pt-3 pb-1">{context}</p>}
    </Panel>
  )
}

export { IncidentList, RecapFacts, RecapPointsPanel, RecapTimelinePanel }

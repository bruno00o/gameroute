import * as m from '@/paraglide/messages'
import type { LivePoint, LiveReading, LiveStatus, RouteZone } from '@/types/backend'
import { formatMs, formatPercent } from '@/lib/format'
import { readingOperator } from '@/lib/live'
import { formatRouteMs, zoneLabel } from '@/lib/route'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/panel'
import { severityText } from '@/components/status/severity-color'
import { SeverityGlyph } from '@/components/status/severity-glyph'

const ZONES: RouteZone[] = ['home', 'isp', 'transit', 'service']
const POINT_ORDER: LivePoint[] = ['gateway', 'isp_edge', 'floor', 'game']

type Row =
  | { kind: 'reading'; key: string; reading: LiveReading }
  | { kind: 'masked'; key: string; zone: RouteZone }

function pointName(reading: LiveReading): string {
  if (reading.point === 'game') return m.live_point_game()
  const name =
    reading.point === 'gateway'
      ? m.live_point_gateway()
      : reading.point === 'isp_edge'
        ? m.live_point_isp_edge()
        : m.live_point_floor()
  const hop = reading.hop != null ? m.live_point_hop({ hop: String(reading.hop) }) : null
  return [name, hop, readingOperator(reading)].filter(Boolean).join(', ')
}

function rows(status: LiveStatus): Row[] {
  const readings = [...status.points].sort(
    (a, b) => POINT_ORDER.indexOf(a.point) - POINT_ORDER.indexOf(b.point)
  )
  return ZONES.flatMap<Row>(zone => {
    const found = readings.filter(reading => reading.zone === zone)
    if (found.length > 0) {
      return found.map(reading => ({ kind: 'reading', key: reading.point, reading }))
    }
    const masked = status.zones.some(
      evidence => evidence.zone === zone && evidence.verdict === 'masked'
    )
    return masked ? [{ kind: 'masked', key: `masked-${zone}`, zone }] : []
  })
}

function LivePoints({ status, frozen = false }: { status: LiveStatus; frozen?: boolean }) {
  const list = rows(status)
  if (list.length === 0) return null

  return (
    <Panel
      data-slot="live-points"
      label={m.live_points_label()}
      title={m.live_points_hint()}
      className="flex-[999_1_560px]"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] border-collapse text-left">
          <thead>
            <tr className="text-label text-muted-foreground font-stretch-[92%]">
              <th scope="col" className="pb-2 font-medium">
                {m.live_points_col_point()}
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                {m.live_readout_label()}
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                {m.matches_col_jitter()}
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                {m.matches_col_loss()}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map(row =>
              row.kind === 'masked' ? (
                <tr key={row.key} data-kind="masked" className="text-ui border-t">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <SeverityGlyph status="unmeasured" size={9} />
                      {zoneLabel(row.zone)}
                    </span>
                  </th>
                  <td
                    colSpan={3}
                    className="text-label text-ink-subtle py-2 text-right font-normal"
                  >
                    {m.verdict_zone_masked()}
                  </td>
                </tr>
              ) : (
                <tr
                  key={row.key}
                  data-point={row.reading.point}
                  data-status={frozen ? 'unmeasured' : row.reading.status}
                  className="text-ui border-t"
                >
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <span className="flex items-center gap-1.5">
                      <SeverityGlyph status={frozen ? 'unmeasured' : row.reading.status} size={9} />
                      <span className={cn('min-w-0', frozen && 'text-muted-foreground')}>
                        {pointName(row.reading)}
                      </span>
                    </span>
                  </th>
                  <td
                    className={cn(
                      'text-data py-2 text-right font-mono tabular-nums',
                      frozen ? 'text-ink-subtle' : severityText[row.reading.status]
                    )}
                  >
                    {row.reading.medianMs == null
                      ? '—'
                      : formatRouteMs(row.reading.medianMs, row.reading.atLeast)}
                  </td>
                  <td className="text-data text-muted-foreground py-2 text-right font-mono tabular-nums">
                    {formatMs(row.reading.jitterMs, { digits: 1 })}
                  </td>
                  <td className="text-data text-muted-foreground py-2 text-right font-mono tabular-nums">
                    {formatPercent(row.reading.lossPct ?? row.reading.lossFloorPct, { digits: 1 })}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export { LivePoints }

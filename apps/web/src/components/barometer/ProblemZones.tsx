import { ROUTE_ZONES, type RouteZone } from '@gameroute/shared'
import { m } from '@/paraglide/messages'

const ZONES: Record<RouteZone, { label: () => string; swatch: string }> = {
  home: { label: m.zone_home, swatch: 'bg-zone-home' },
  isp: { label: m.zone_isp, swatch: 'bg-zone-isp' },
  transit: { label: m.zone_transit, swatch: 'bg-zone-transit' },
  service: { label: m.zone_service, swatch: 'bg-zone-service' },
}

export function ProblemZones() {
  return (
    <section className="gw-wrap flex flex-col gap-6 py-20" aria-labelledby="zones-title">
      <div className="flex max-w-[760px] flex-col gap-3">
        <h2 id="zones-title" className="gw-h2">
          {m.zones_title()}
        </h2>
        <p className="gw-text">{m.zones_text()}</p>
      </div>
      <ul
        aria-label={m.zones_label()}
        className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-0.5 p-0"
      >
        {ROUTE_ZONES.map(zone => (
          <li key={zone} className="flex flex-col gap-1.5">
            <span className={`block h-3 ${ZONES[zone].swatch}`} aria-hidden="true" />
            <span className="gw-zone">{ZONES[zone].label()}</span>
            <span className="flex items-center gap-2 text-[13px] text-ink-muted">
              <span className="gw-collect block h-3 w-12" aria-hidden="true" />
              {m.zones_collecting()}
            </span>
          </li>
        ))}
      </ul>
      <p className="gw-small">{m.zones_note()}</p>
    </section>
  )
}

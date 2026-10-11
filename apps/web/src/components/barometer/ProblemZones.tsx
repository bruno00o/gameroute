import { ROUTE_ZONES, type RouteZone } from '@gameroute/shared'
import { Container } from '@/components/Container'
import { Small, Text, Title } from '@/components/Typography'
import { m } from '@/paraglide/messages'

const ZONES: Record<RouteZone, { label: () => string; swatch: string }> = {
  home: { label: m.zone_home, swatch: 'bg-zone-home' },
  isp: { label: m.zone_isp, swatch: 'bg-zone-isp' },
  transit: { label: m.zone_transit, swatch: 'bg-zone-transit' },
  service: { label: m.zone_service, swatch: 'bg-zone-service' },
}

export function ProblemZones() {
  return (
    <section aria-labelledby="zones-title">
      <Container className="flex flex-col gap-6 py-20">
        <div className="flex max-w-[760px] flex-col gap-3">
          <Title id="zones-title">{m.zones_title()}</Title>
          <Text>{m.zones_text()}</Text>
        </div>
        <ul
          aria-label={m.zones_label()}
          className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-0.5"
        >
          {ROUTE_ZONES.map(zone => (
            <li key={zone} className="flex flex-col gap-1.5">
              <span className={`block h-3 ${ZONES[zone].swatch}`} aria-hidden="true" />
              <span className="text-overline text-subtle-foreground uppercase font-stretch-88%">
                {ZONES[zone].label()}
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="hatch block h-3 w-12" aria-hidden="true" />
                {m.zones_collecting()}
              </span>
            </li>
          ))}
        </ul>
        <Small>{m.zones_note()}</Small>
      </Container>
    </section>
  )
}

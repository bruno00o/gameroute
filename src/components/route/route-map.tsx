import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { geoBounds, geoMercator, geoPath } from 'd3-geo'
import type { Polygon } from 'geojson'

import * as m from '@/paraglide/messages'
import type { DbHop, OperatorRoute, RouteZone } from '@/types/backend'
import { resolveHostnames } from '@/lib/tauri'
import { zoneLabel } from '@/lib/route'
import { routeGeo, type GeoPlace, type RouteGeo } from '@/lib/route-geo'
import { cn } from '@/lib/utils'
import { atlasCountry, loadAtlas, mainland, type Atlas } from '@/lib/world-atlas'
import { useAsnResolution } from '@/hooks/use-asn-resolution'
import { Skeleton } from '@/components/ui/skeleton'

const HEIGHT = 220
const DEFAULT_WIDTH = 640
const ZONES: RouteZone[] = ['home', 'isp', 'transit', 'service']
const ZONE_COLORS: Record<RouteZone, string> = {
  home: 'var(--zone-home, var(--ink-subtle))',
  isp: 'var(--zone-isp, var(--signal))',
  transit: 'var(--zone-transit, var(--route-a))',
  service: 'var(--zone-service, var(--ink))',
}
const NEUTRAL = 'var(--ink-subtle)'
const HOME_TINT = 'color-mix(in oklab, var(--zone-home, var(--ink-subtle)) 16%, var(--card))'

function frame(places: GeoPlace[], home: Polygon | null): [number, number][] | null {
  const lons = places.map(place => place.lon)
  const lats = places.map(place => place.lat)
  if (home) {
    const [[west, south], [east, north]] = geoBounds(home)
    lons.push(west, east)
    lats.push(south, north)
  }
  if (lons.length === 0) return null
  const [west, east] = [Math.min(...lons), Math.max(...lons)]
  const [south, north] = [Math.min(...lats), Math.max(...lats)]
  const padLon = Math.max(0, 14 - (east - west)) / 2
  const padLat = Math.max(0, 8 - (north - south)) / 2
  return [
    [west - padLon, Math.max(south - padLat, -70)],
    [east + padLon, Math.min(north + padLat, 75)],
  ]
}

function hopRange(place: GeoPlace): string | null {
  if (place.firstHop == null) return null
  return place.lastHop != null && place.lastHop !== place.firstHop
    ? `#${place.firstHop}–${place.lastHop}`
    : `#${place.firstHop}`
}

type Spot = { key: string; name: string; x: number; y: number; zones: (RouteZone | null)[] }
type Box = { left: number; right: number; top: number; bottom: number }

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

function placeLabels(spots: Spot[], width: number) {
  const boxes: Box[] = spots.map(spot => {
    const half = (spot.zones.length * 9) / 2
    return { left: spot.x - half, right: spot.x + half, top: spot.y - 6, bottom: spot.y + 6 }
  })
  return spots.map(spot => {
    const text = spot.name.length * 6.4
    const half = (spot.zones.length * 9) / 2 + 4
    const options = [
      {
        anchor: 'start' as const,
        x: spot.x + half,
        left: spot.x + half,
        right: spot.x + half + text,
      },
      {
        anchor: 'end' as const,
        x: spot.x - half,
        left: spot.x - half - text,
        right: spot.x - half,
      },
    ]
    for (const option of options) {
      const box = { left: option.left, right: option.right, top: spot.y - 7, bottom: spot.y + 7 }
      if (box.left < 2 || box.right > width - 2) continue
      if (boxes.some(other => overlaps(box, other))) continue
      boxes.push(box)
      return { key: spot.key, name: spot.name, x: option.x, y: spot.y + 4, anchor: option.anchor }
    }
    return null
  })
}

function RouteMapView({
  geo,
  atlas,
  width = DEFAULT_WIDTH,
}: {
  geo: RouteGeo
  atlas: Atlas
  width?: number
}) {
  const homeFeature = atlasCountry(atlas, geo.homeCountry)

  const drawing = useMemo(() => {
    const home = homeFeature ? mainland(homeFeature) : null
    const bounds = frame(geo.places, home)
    if (!bounds) return null
    const projection = geoMercator()
      .fitExtent(
        [
          [56, 24],
          [width - 56, HEIGHT - 24],
        ],
        { type: 'MultiPoint', coordinates: bounds }
      )
      .clipExtent([
        [0, 0],
        [width, HEIGHT],
      ])
    const path = geoPath(projection)

    const spots = new Map<string, Spot>()
    for (const place of geo.places) {
      const [x, y] = projection([place.lon, place.lat]) ?? [0, 0]
      const spot = spots.get(place.key) ?? { key: place.key, name: place.name, x, y, zones: [] }
      if (!spot.zones.includes(place.zone)) spot.zones.push(place.zone)
      spots.set(place.key, spot)
    }
    const list = [...spots.values()]

    return {
      land: path(atlas.land) ?? '',
      borders: path(atlas.borders) ?? '',
      home: homeFeature ? (path(homeFeature) ?? '') : '',
      links: geo.links
        .filter(link => link.from.key !== link.to.key)
        .map(link => ({
          key: `${link.from.key}-${link.to.key}-${link.from.lastHop}`,
          skipped: link.skipped,
          d:
            path({
              type: 'LineString',
              coordinates: [
                [link.from.lon, link.from.lat],
                [link.to.lon, link.to.lat],
              ],
            }) ?? '',
        })),
      spots: list,
      labels: placeLabels(list, width),
    }
  }, [geo, atlas, homeFeature, width])

  const details = (key: string) =>
    geo.places
      .filter(place => place.key === key)
      .map(place => [place.operator, hopRange(place)].filter(Boolean).join(' '))
      .filter(Boolean)
      .join(', ')

  const zones = ZONES.filter(zone => geo.places.some(place => place.zone === zone))
  const serviceName = geo.places.find(place => place.zone === 'service')?.operator ?? undefined
  const names = [...new Set(geo.places.map(place => place.name))]

  return (
    <figure className="min-w-0">
      {drawing ? (
        <svg
          role="img"
          aria-label={m.route_map_aria({ places: names.join(', ') || '—' })}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          className="block rounded-sm border"
        >
          <rect width={width} height={HEIGHT} style={{ fill: 'var(--surface-sunken)' }} />
          <path
            d={drawing.land}
            style={{ fill: 'var(--card)', stroke: 'var(--line-strong)' }}
            strokeWidth={0.5}
          />
          {drawing.home && <path d={drawing.home} style={{ fill: HOME_TINT }} />}
          <path
            d={drawing.borders}
            fill="none"
            style={{ stroke: 'var(--line)' }}
            strokeWidth={0.75}
          />
          {drawing.links.map(link => (
            <path
              key={link.key}
              data-slot="route-map-link"
              data-skipped={link.skipped || undefined}
              d={link.d}
              fill="none"
              style={{ stroke: 'var(--ink-muted)' }}
              strokeWidth={1.5}
              strokeDasharray={link.skipped ? '3 3' : undefined}
              strokeLinecap="round"
            />
          ))}
          {drawing.spots.map(spot => (
            <g key={spot.key}>
              <title>{[spot.name, details(spot.key)].filter(Boolean).join(', ')}</title>
              {spot.zones.map((zone, i) => (
                <circle
                  key={zone ?? 'none'}
                  data-slot="route-map-point"
                  data-zone={zone ?? undefined}
                  cx={spot.x + (i - (spot.zones.length - 1) / 2) * 9}
                  cy={spot.y}
                  r={4}
                  style={{ fill: zone ? ZONE_COLORS[zone] : NEUTRAL, stroke: 'var(--card)' }}
                  strokeWidth={1.5}
                />
              ))}
            </g>
          ))}
          {drawing.labels.map(
            label =>
              label && (
                <text
                  key={label.key}
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  fontSize={11}
                  style={{ fill: 'var(--ink)', stroke: 'var(--card)', paintOrder: 'stroke' }}
                  strokeWidth={3}
                  strokeLinejoin="round"
                >
                  {label.name}
                </text>
              )
          )}
        </svg>
      ) : (
        <p className="text-ui text-muted-foreground">{m.route_map_none()}</p>
      )}
      <figcaption className="text-label text-muted-foreground mt-2 font-normal">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {zones.map(zone => (
            <li key={zone} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: ZONE_COLORS[zone] }}
              />
              {zoneLabel(zone, serviceName)}
            </li>
          ))}
          {homeFeature && geo.homeCountry && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-[2px] border"
                style={{ background: HOME_TINT }}
              />
              {m.route_map_home_country({ country: geo.homeCountry })}
            </li>
          )}
          {geo.riot && (
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="border-ink-subtle size-2 rounded-full border border-dashed"
              />
              {m.route_map_riot()}
            </li>
          )}
          <li className="tabular-nums">
            {m.route_map_located({ located: String(geo.located), total: String(geo.total) })}
          </li>
        </ul>
        <p className="text-ink-subtle mt-1.5 max-w-[80ch]">{m.route_map_source()}</p>
      </figcaption>
    </figure>
  )
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      if (next > 0) setWidth(next)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function RouteMap({
  hops,
  targetIp,
  route,
  className,
}: {
  hops: DbHop[]
  targetIp: string
  route: OperatorRoute | null | undefined
  className?: string
}) {
  const ips = useMemo(
    () => [...new Set([targetIp, ...hops.flatMap(hop => hop.ip ?? [])])],
    [targetIp, hops]
  )
  const { data: asnData, loading } = useAsnResolution(ips)
  const names = useQuery({
    queryKey: ['hostnames', ips],
    queryFn: () => resolveHostnames(ips),
    staleTime: Infinity,
  })
  const atlas = useQuery({
    queryKey: ['world-atlas'],
    queryFn: loadAtlas,
    staleTime: Infinity,
    gcTime: Infinity,
  })
  const hostnames = useMemo(
    () => new Map((names.data ?? []).map(entry => [entry.ip, entry.hostname])),
    [names.data]
  )
  const geo = useMemo(
    () => routeGeo({ hops, targetIp, route, asnData, hostnames }),
    [hops, targetIp, route, asnData, hostnames]
  )
  const [ref, width] = useWidth()

  return (
    <div ref={ref} data-slot="route-map" className={cn('min-w-0', className)}>
      {atlas.isError ? null : atlas.data && !names.isPending && !loading ? (
        <RouteMapView geo={geo} atlas={atlas.data} width={width} />
      ) : (
        <Skeleton className="w-full" style={{ height: HEIGHT }} />
      )}
    </div>
  )
}

export { RouteMap, RouteMapView }

import * as m from '@/paraglide/messages'
import { formatMs } from '@/lib/format'
import type { RouteMapPoint } from '@/lib/route'
import { cn } from '@/lib/utils'
import { ExpandableMap } from '@/components/expandable-map'
import {
  Map,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  MarkerTooltip,
} from '@/components/ui/map'

function RouteMap({ points, className }: { points: RouteMapPoint[]; className?: string }) {
  return (
    <div data-slot="route-map" className={cn('overflow-hidden rounded-sm border', className)}>
      <ExpandableMap className="h-52" renderExpanded={() => <RouteMapContent points={points} />}>
        <RouteMapContent points={points} />
      </ExpandableMap>
    </div>
  )
}

function RouteMapContent({ points }: { points: RouteMapPoint[] }) {
  const coordinates = points.map(point => [point.lon, point.lat] as [number, number])
  const center: [number, number] = [
    points.reduce((sum, point) => sum + point.lon, 0) / points.length,
    points.reduce((sum, point) => sum + point.lat, 0) / points.length,
  ]

  return (
    <Map center={center} zoom={points.length > 1 ? 2 : 4}>
      <MapControls />
      {coordinates.length > 1 && (
        <MapRoute coordinates={coordinates} width={3} opacity={0.8} interactive={false} />
      )}
      {points.map((point, i) => {
        const silent = point.stops.every(stop => stop.silent)
        const numbers = point.stops.flatMap(stop =>
          stop.hopNumber != null ? [stop.hopNumber] : []
        )
        const label =
          numbers.length === 0
            ? ''
            : numbers.length === 1
              ? String(numbers[0])
              : `${numbers[0]}-${numbers[numbers.length - 1]}`
        const end = i === 0 || i === points.length - 1

        return (
          <MapMarker key={`${point.lon}:${point.lat}`} longitude={point.lon} latitude={point.lat}>
            <MarkerContent>
              <div
                className={cn(
                  'flex items-center justify-center rounded-full font-mono font-semibold',
                  end ? 'size-5 text-[9px]' : 'size-4 text-[8px]',
                  silent
                    ? 'border-ink-subtle bg-card/80 border-[1.5px] border-dashed'
                    : 'bg-foreground text-background shadow-[0_0_0_2px_var(--card)]'
                )}
              >
                {label}
              </div>
            </MarkerContent>
            <MarkerTooltip>
              <div className="space-y-1">
                {point.stops.map(stop => (
                  <div key={stop.ip} className="flex items-center gap-2">
                    <span className="font-semibold">
                      {stop.hopNumber != null ? `#${stop.hopNumber}` : '→'}
                    </span>
                    <span className="font-mono">{stop.ip}</span>
                    {stop.silent ? (
                      <span className="opacity-70">{m.hop_silent()}</span>
                    ) : (
                      stop.latency != null && (
                        <span className="font-mono tabular-nums">{formatMs(stop.latency)}</span>
                      )
                    )}
                  </div>
                ))}
                {point.stops[0].operator && (
                  <div className="opacity-70">{point.stops[0].operator}</div>
                )}
              </div>
            </MarkerTooltip>
          </MapMarker>
        )
      })}
    </Map>
  )
}

export { RouteMap }

import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'
import type { UsualRoute } from '@/types/backend'
import { formatDay } from '@/lib/format'
import { routeMapPoints } from '@/lib/route'
import { useAsnResolution } from '@/hooks/use-asn-resolution'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/panel'
import { RouteMap } from '@/components/route/route-map'

function UsualRouteMap({ usual }: { usual: UsualRoute }) {
  const [shown, setShown] = useState(false)
  const { latest } = usual

  const ips = useMemo(
    () =>
      shown ? [...new Set([latest.targetIp, ...latest.hops.flatMap(hop => hop.ip ?? [])])] : [],
    [shown, latest]
  )
  const { data: asnData, loading } = useAsnResolution(ips)
  const points = useMemo(
    () => (shown ? routeMapPoints(latest.hops, latest.targetIp, asnData) : []),
    [shown, latest, asnData]
  )

  return (
    <Panel
      label={m.route_map_label()}
      action={
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={shown}
          onClick={() => setShown(open => !open)}
        >
          {shown ? m.route_hide_map() : m.route_show_map()}
        </Button>
      }
    >
      <p className="text-ui text-muted-foreground max-w-[70ch]">{m.route_map_note()}</p>
      {shown && points.length > 0 && <RouteMap className="mt-4" points={points} />}
      {shown && points.length === 0 && !loading && (
        <p className="text-ui text-muted-foreground mt-4">{m.network_map_empty()}</p>
      )}
      {shown && (
        <p className="text-label text-ink-subtle mt-3 font-normal">
          {m.route_map_latest({ date: formatDay(latest.startedAt) })}{' '}
          <Link
            to="/sessions/$id/matches/$n"
            params={{ id: String(latest.sessionId), n: String(latest.matchNumber) }}
            className="text-foreground decoration-line-strong hover:decoration-foreground underline underline-offset-4"
          >
            {m.route_open_match()}
          </Link>
        </p>
      )}
    </Panel>
  )
}

export { UsualRouteMap }

import { Link } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'
import type { UsualRoute } from '@/types/backend'
import { formatDay } from '@/lib/format'
import { Panel } from '@/components/panel'
import { RouteMap } from '@/components/route/route-map'

function UsualRouteMap({ usual }: { usual: UsualRoute }) {
  const { latest } = usual

  return (
    <Panel label={m.route_map_label()}>
      <RouteMap hops={latest.hops} targetIp={latest.targetIp} route={usual.route} />
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
    </Panel>
  )
}

export { UsualRouteMap }

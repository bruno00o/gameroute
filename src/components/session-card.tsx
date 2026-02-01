import { Link } from '@tanstack/react-router'
import { RiGlobalLine, RiRouteLine, RiTimeLine } from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { SessionListItem } from '@/types/backend'
import { formatDate, formatDuration, computeDurationSecs } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function SessionCard({ session }: { session: SessionListItem }) {
  const isActive = session.endedAt === null
  const durationSecs = computeDurationSecs(session.startedAt, session.endedAt)

  return (
    <Link to="/sessions/$id" params={{ id: String(session.id) }} search={{ period: undefined }}>
      <Card className="hover:bg-muted/50 cursor-pointer transition-colors">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{session.gameName}</CardTitle>
            <Badge variant={isActive ? 'default' : 'secondary'}>
              {isActive ? m.sessions_status_active() : m.sessions_status_completed()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span className="flex items-center gap-1">
              <RiGlobalLine className="size-3" />
              {m.sessions_ips({ count: String(session.uniqueIpCount) })}
            </span>
            <span className="flex items-center gap-1">
              <RiRouteLine className="size-3" />
              {m.sessions_traceroutes({ count: String(session.tracerouteCount) })}
            </span>
          </div>
          <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
            <span>{formatDate(session.startedAt)}</span>
            <span className="flex items-center gap-1">
              <RiTimeLine className="size-3" />
              {formatDuration(durationSecs)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

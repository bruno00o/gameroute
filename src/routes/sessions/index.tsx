import { Link, createFileRoute } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'
import {
  mockSessions,
  formatDate,
  formatDuration,
} from '@/lib/mock-sessions'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/sessions/')({
  component: SessionsPage,
})

const statusVariant = {
  completed: 'secondary',
  active: 'default',
  failed: 'destructive',
} as const

function SessionsPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_sessions_title()}</h1>
      <p className="text-muted-foreground mt-2">
        {m.page_sessions_description()}
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mockSessions.map((session) => (
          <Link key={session.id} to="/sessions/$id" params={{ id: session.id }} search={{ hop: undefined }}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{session.game}</CardTitle>
                  <Badge variant={statusVariant[session.status]}>
                    {session.status}
                  </Badge>
                </div>
                <CardDescription>{session.server}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground flex items-center justify-between text-xs">
                  <span>{session.region}</span>
                  <span>{session.hops.length} hops</span>
                </div>
                <div className="text-muted-foreground flex items-center justify-between text-xs mt-1">
                  <span>{formatDate(session.date)}</span>
                  <span>{formatDuration(session.duration)}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

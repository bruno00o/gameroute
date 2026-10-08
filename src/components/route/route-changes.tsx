import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'
import type { RouteChange, UsualRoute } from '@/types/backend'
import { changeFacts, changePeriod, changeSummary } from '@/lib/route-history'
import { Button } from '@/components/ui/button'

const VISIBLE = 5

type RouteChangesProps = {
  changes: RouteChange[]
  usual: UsualRoute | undefined
}

function RouteChanges({ changes, usual }: RouteChangesProps) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? changes : changes.slice(0, VISIBLE)
  const hidden = changes.length - VISIBLE

  return (
    <div data-slot="route-changes">
      <ul className="flex flex-col divide-y">
        {shown.map(change => (
          <li
            key={`${change.sessionId}-${change.matchNumber}`}
            className="grid grid-cols-[minmax(96px,150px)_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="text-data-sm text-muted-foreground pt-0.5 font-mono tabular-nums">
              {changePeriod(change)}
            </span>
            <div className="min-w-0">
              <p className="text-ui text-foreground">{changeSummary(change)}</p>
              <p className="text-label text-ink-subtle mt-0.5 font-normal">
                {changeFacts(change, usual)}
              </p>
            </div>
            <Link
              to="/sessions/$id/matches/$n"
              params={{ id: String(change.sessionId), n: String(change.matchNumber) }}
              className="text-ui text-foreground decoration-line-strong hover:decoration-foreground whitespace-nowrap underline underline-offset-4"
            >
              {m.route_open_match()}
            </Link>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3"
          aria-expanded={expanded}
          onClick={() => setExpanded(open => !open)}
        >
          {expanded ? m.route_changes_less() : m.route_changes_more({ count: String(hidden) })}
        </Button>
      )}
    </div>
  )
}

export { RouteChanges, type RouteChangesProps }

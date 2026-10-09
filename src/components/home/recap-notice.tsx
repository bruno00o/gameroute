import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import * as m from '@/paraglide/messages'
import type { SessionListItem } from '@/types/backend'
import { formatClock } from '@/lib/format'
import { recentMatch } from '@/lib/recap'
import { getSessionMatches } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/notice'

const RECENT_SESSION_MS = 2 * 60 * 60_000

function RecapNotice({ session }: { session: SessionListItem | undefined }) {
  const navigate = useNavigate()
  const [now] = useState(() => Date.now())
  const recent =
    session != null &&
    (session.endedAt === null || now - Date.parse(session.endedAt) <= RECENT_SESSION_MS)

  const { data: matches } = useQuery({
    queryKey: ['session', session?.id, 'matches'],
    queryFn: () => getSessionMatches(session!.id),
    enabled: recent,
    staleTime: 60_000,
  })
  const match = matches && recentMatch(matches, now)
  if (!session || !match) return null

  return (
    <Notice
      title={m.recap_notice_title({
        number: String(match.number),
        game: session.gameName,
        time: formatClock(match.endedAt),
      })}
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            navigate({
              to: '/sessions/$id/matches/$n/recap',
              params: { id: String(session.id), n: String(match.number) },
            })
          }
        >
          {m.recap_open()}
        </Button>
      }
    >
      {m.recap_notice_body()}
    </Notice>
  )
}

export { RecapNotice }

import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { getAppSettings, getMatchIncidents, onLiveStatus } from '@/lib/tauri'
import { matchEndMessage, shouldAnnounce, summarizeMatch } from '@/lib/match-end'

const TOAST_MS = 30_000

type Match = { sessionId: number; matchStartedAt: string }

export function useMatchEndToast() {
  const navigate = useNavigate()

  useEffect(() => {
    let current: Match | null = null

    const announce = async (match: Match) => {
      try {
        const [settings, incidents] = await Promise.all([
          getAppSettings(),
          getMatchIncidents(match.sessionId),
        ])
        const now = Date.now()
        const summary = summarizeMatch(incidents, match.matchStartedAt, now)
        if (!shouldAnnounce(settings.alerts.recap, summary)) return
        const { title, description } = matchEndMessage(summary, match.matchStartedAt, now)
        toast.info(title, {
          description,
          duration: TOAST_MS,
          action: {
            label: m.match_end_open(),
            onClick: () =>
              navigate({ to: '/sessions/$id', params: { id: String(match.sessionId) } }),
          },
        })
      } catch (e) {
        console.warn('[live] Could not announce the end of the match:', e)
      }
    }

    const unlisten = onLiveStatus(status => {
      const next =
        status && status.matchStartedAt
          ? { sessionId: status.sessionId, matchStartedAt: status.matchStartedAt }
          : null
      const previous = current
      current = next
      if (
        previous &&
        (!next ||
          next.sessionId !== previous.sessionId ||
          next.matchStartedAt !== previous.matchStartedAt)
      ) {
        void announce(previous)
      }
    })

    return () => {
      void unlisten.then(off => off())
    }
  }, [navigate])
}

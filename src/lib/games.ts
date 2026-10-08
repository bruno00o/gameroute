import * as m from '@/paraglide/messages'
import type { GameProfile, ServerSummaryItem, Severity } from '@/types/backend'
import { formatDay } from '@/lib/format'
import { formatRouteMs } from '@/lib/route'

export const SUMMARY_DAYS = 7

const LAUNCHERS: Record<string, string> = { riot: 'Riot', steam: 'Steam', epic: 'Epic' }

export function launcherName(source: string): string | null {
  if (source === 'manual') return null
  return LAUNCHERS[source] ?? source
}

export type ProfileText = { title: string; detail: string | null }

export function profileText(profile: GameProfile | null): ProfileText {
  if (!profile) {
    return { title: m.games_profile_none(), detail: m.games_profile_none_detail() }
  }

  const title = [
    profile.operator,
    profile.asn != null ? `AS${profile.asn}` : null,
    profile.relay ? m.games_profile_relay() : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const details: string[] = []
  if (profile.relay) {
    details.push(m.games_profile_relay_detail())
  } else {
    if (profile.udpPorts) {
      const [from, to] = profile.udpPorts
      details.push(m.games_profile_ports({ from: String(from), to: String(to) }))
    }
    if (profile.voiceSeparate) details.push(m.games_profile_voice())
  }

  return { title, detail: details.length > 0 ? details.join(' · ') : null }
}

export type GameNetwork = {
  status: Severity | null
  ping: string | null
  usual: string | null
  servers: string | null
  incident: string | null
}

export function groupServersByGame(servers: ServerSummaryItem[]): Map<string, ServerSummaryItem[]> {
  const byGame = new Map<string, ServerSummaryItem[]>()
  for (const server of servers) {
    const list = byGame.get(server.gameName)
    if (list) list.push(server)
    else byGame.set(server.gameName, [server])
  }
  return byGame
}

function latestFirst(a: ServerSummaryItem, b: ServerSummaryItem): number {
  return new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime()
}

export function gameNetwork(servers: ServerSummaryItem[] | undefined): GameNetwork | null {
  if (!servers || servers.length === 0) return null

  const primary = [...servers].sort(latestFirst)[0]
  const incident = servers
    .flatMap(server => (server.lastIncident ? [server.lastIncident] : []))
    .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime())[0]
  const atLeast = primary.basis ? !primary.basis.atDestination : false
  const usualMs = primary.usual.medianMs

  return {
    status: primary.status,
    ping: primary.recent ? formatRouteMs(primary.recent.medianMs, atLeast) : null,
    usual:
      usualMs != null
        ? m.games_network_usual({ usual: formatRouteMs(usualMs, atLeast) })
        : primary.recent
          ? m.games_network_no_usual()
          : null,
    servers: servers.length > 1 ? m.games_network_servers({ count: String(servers.length) }) : null,
    incident: incident ? m.games_network_incident({ date: formatDay(incident.measuredAt) }) : null,
  }
}

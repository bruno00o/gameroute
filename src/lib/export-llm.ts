import type {
  SessionDetail,
  NetworkOverviewStats,
  RecurringProblemHop,
  ServerStability,
} from '@/types/backend'
import { formatDuration, formatMs, computeDurationSecs } from '@/lib/format'
import { getLocale } from '@/paraglide/runtime'

const EN = 'en'

function formatIsoShort(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

export function generateSessionExport(detail: SessionDetail): string {
  const durationSecs = computeDurationSecs(detail.startedAt, detail.endedAt)

  const gameServerIps = new Set(
    detail.ipSummaries.filter(s => s.isGameServer).map(s => s.ip),
  )

  const lines: string[] = []

  lines.push(
    'You are a network diagnostics expert specializing in online gaming. Analyze the following gaming session data and identify potential causes of lag, packet loss, or high latency. Focus on which network segment (ISP, transit, or game server) is most likely responsible.',
  )
  lines.push('')

  // Session metadata
  lines.push('<session>')
  lines.push(`Game: ${detail.gameName}`)
  lines.push(`Duration: ${formatDuration(durationSecs, EN)}`)
  lines.push(`Start: ${formatIsoShort(detail.startedAt)}`)
  if (detail.endedAt) {
    lines.push(`End: ${formatIsoShort(detail.endedAt)}`)
  }
  lines.push(`Server IPs: ${detail.ipSummaries.length} unique (${detail.ipPeriods.length} connection periods)`)
  lines.push('</session>')
  lines.push('')

  // Game server connections
  const gsServers = detail.ipSummaries.filter(s => s.isGameServer)
  if (gsServers.length > 0) {
    lines.push('<game-servers>')
    for (const s of gsServers) {
      lines.push(
        `- ${s.ip} (${s.protocol}:${s.port}) — ${formatDuration(s.totalDurationSecs, EN)}, ${s.totalPacketCount} packets, ${s.periodCount} period(s)`,
      )
    }
    lines.push('</game-servers>')
    lines.push('')
  }

  // Traceroutes
  const gsTraceroutes = detail.traceroutes.filter(tr => gameServerIps.has(tr.targetIp))
  const otherTraceroutes = detail.traceroutes.filter(tr => !gameServerIps.has(tr.targetIp))

  const renderTraceroute = (tr: (typeof detail.traceroutes)[0]) => {
    lines.push(`### Traceroute to ${tr.targetIp}${gameServerIps.has(tr.targetIp) ? ' (game server)' : ''}`)
    if (tr.tracerouteMethod) lines.push(`Method: ${tr.tracerouteMethod}`)
    lines.push('')
    lines.push('| Hop | IP | Hostname | Avg RTT | Loss % | Problem |')
    lines.push('|-----|------|----------|---------|--------|---------|')
    for (const hop of tr.hops) {
      const ip = hop.ip ?? '*'
      const hostname = hop.hostname ?? '-'
      const rtt = hop.latencyAvg != null ? formatMs(hop.latencyAvg, { locale: EN }) : '*'
      const loss = hop.packetLoss != null ? `${hop.packetLoss.toFixed(0)}%` : '-'
      const problem = hop.isProblemHop ? 'YES' : '-'
      lines.push(`| ${hop.hopNumber} | ${ip} | ${hostname} | ${rtt} | ${loss} | ${problem} |`)
    }
    lines.push('')
  }

  if (gsTraceroutes.length > 0 || otherTraceroutes.length > 0) {
    lines.push('<traceroutes>')
    lines.push('')
    for (const tr of gsTraceroutes) renderTraceroute(tr)
    for (const tr of otherTraceroutes) renderTraceroute(tr)
    lines.push('</traceroutes>')
    lines.push('')
  }

  // Problem hops summary
  const allProblemHops = detail.traceroutes.flatMap(tr =>
    tr.hops.filter(h => h.isProblemHop).map(h => ({
      ip: h.ip,
      hopNumber: h.hopNumber,
      latencyAvg: h.latencyAvg,
      packetLoss: h.packetLoss,
      targetIp: tr.targetIp,
      isGameServer: gameServerIps.has(tr.targetIp),
    })),
  )

  if (allProblemHops.length > 0) {
    lines.push('<problem-hops>')
    for (const h of allProblemHops) {
      const route = h.isGameServer ? 'game server route' : 'other route'
      lines.push(
        `- Hop ${h.hopNumber} (${h.ip ?? 'unknown'}) on ${route} to ${h.targetIp}: ${h.latencyAvg != null ? formatMs(h.latencyAvg, { locale: EN }) : 'timeout'}${h.packetLoss != null && h.packetLoss > 0 ? `, ${h.packetLoss.toFixed(0)}% loss` : ''}`,
      )
    }
    lines.push('</problem-hops>')
    lines.push('')
  }

  // Questions
  lines.push('Based on this data:')
  lines.push('1. What is the most likely cause of the network issues (if any)?')
  lines.push('2. Is this problem on my ISP\'s network, a transit provider, or the game server side?')
  lines.push('3. What can I do to improve my connection for this game?')
  lines.push('')
  lines.push(`Please respond in: ${getLocale()}`)

  return lines.join('\n')
}

export function generateNetworkExport(
  stats: NetworkOverviewStats,
  problemHops: RecurringProblemHop[],
  stability: ServerStability[],
): string {
  const lines: string[] = []

  lines.push(
    'You are a network diagnostics expert specializing in online gaming. Analyze the following aggregated network data from multiple gaming sessions and identify patterns, recurring issues, and actionable recommendations.',
  )
  lines.push('')

  // Overview stats
  lines.push('<network-overview>')
  lines.push(`Unique server IPs: ${stats.uniqueServerIps}`)
  lines.push(`Total traceroutes: ${stats.totalTraceroutes}`)
  lines.push(`Total problem hops: ${stats.totalProblemHops}`)
  lines.push(`Average latency: ${stats.avgLatency != null ? `${stats.avgLatency.toFixed(1)} ms` : 'N/A'}`)
  lines.push('</network-overview>')
  lines.push('')

  // Problem hops
  if (problemHops.length > 0) {
    const gsHops = problemHops.filter(h => h.isGameServerRoute)
    const otherHops = problemHops.filter(h => !h.isGameServerRoute)

    lines.push('<problem-hops>')
    lines.push('')
    if (gsHops.length > 0) {
      lines.push('### Game Server Routes')
      lines.push('| IP | Provider | Occurrences | Avg Latency | Avg Loss |')
      lines.push('|------|----------|-------------|-------------|----------|')
      for (const h of gsHops) {
        const provider = [h.isp, h.asn ? `(${h.asn})` : null].filter(Boolean).join(' ') || '-'
        lines.push(
          `| ${h.ip} | ${provider} | ${h.occurrenceCount} | ${h.avgLatency != null ? formatMs(h.avgLatency, { locale: EN }) : '-'} | ${h.avgPacketLoss != null ? `${h.avgPacketLoss.toFixed(0)}%` : '-'} |`,
        )
      }
      lines.push('')
    }
    if (otherHops.length > 0) {
      lines.push('### Other Routes')
      lines.push('| IP | Provider | Occurrences | Avg Latency | Avg Loss |')
      lines.push('|------|----------|-------------|-------------|----------|')
      for (const h of otherHops) {
        const provider = [h.isp, h.asn ? `(${h.asn})` : null].filter(Boolean).join(' ') || '-'
        lines.push(
          `| ${h.ip} | ${provider} | ${h.occurrenceCount} | ${h.avgLatency != null ? formatMs(h.avgLatency, { locale: EN }) : '-'} | ${h.avgPacketLoss != null ? `${h.avgPacketLoss.toFixed(0)}%` : '-'} |`,
        )
      }
      lines.push('')
    }
    lines.push('</problem-hops>')
    lines.push('')
  }

  // Server stability
  if (stability.length > 0) {
    lines.push('<server-stability>')
    lines.push('| IP | Provider | Country | Avg Latency | Avg Loss | Traceroutes | Problem % |')
    lines.push('|------|----------|---------|-------------|----------|-------------|-----------|')
    for (const s of stability) {
      const provider = [s.isp, s.asn ? `(${s.asn})` : null].filter(Boolean).join(' ') || '-'
      lines.push(
        `| ${s.ip} | ${provider} | ${s.country ?? '-'} | ${s.avgLatency != null ? formatMs(s.avgLatency, { locale: EN }) : '-'} | ${s.avgPacketLoss != null ? `${s.avgPacketLoss.toFixed(0)}%` : '-'} | ${s.tracerouteCount} | ${(s.problemHopRatio * 100).toFixed(0)}% |`,
      )
    }
    lines.push('</server-stability>')
    lines.push('')
  }

  // Questions
  lines.push('Based on this data:')
  lines.push('1. Which network segments or providers are causing the most issues?')
  lines.push('2. Are there recurring patterns (specific ISPs, transit providers, or regions)?')
  lines.push('3. What concrete steps can I take to improve my gaming network quality?')
  lines.push('')
  lines.push(`Please respond in: ${getLocale()}`)

  return lines.join('\n')
}

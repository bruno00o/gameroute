import { save } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type {
  SessionDetail,
  SessionListItem,
  ServerStability,
} from '@/types/backend'
import { formatDuration, computeDurationSecs } from '@/lib/format'
import { writeExportFile } from '@/lib/tauri'

function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsv).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(','))
  }
  return lines.join('\n')
}

async function saveWithDialog(defaultName: string, content: string): Promise<boolean> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (!path) return false
  await writeExportFile(path, content)
  return true
}

export async function exportSessionsList(sessions: SessionListItem[]) {
  const headers = ['ID', 'Game', 'Started', 'Ended', 'Duration', 'Unique IPs', 'Traceroutes']
  const rows = sessions.map(s => [
    s.id,
    s.gameName,
    s.startedAt,
    s.endedAt ?? '',
    formatDuration(computeDurationSecs(s.startedAt, s.endedAt), 'en'),
    s.uniqueIpCount,
    s.tracerouteCount,
  ])

  try {
    const saved = await saveWithDialog('gameroute-sessions.csv', toCsv(headers, rows))
    if (saved) toast.success(m.export_csv_saved())
  } catch {
    toast.error(m.export_csv_error())
  }
}

export async function exportSessionDetail(detail: SessionDetail) {
  const headers = [
    'Traceroute Target',
    'Hop #',
    'IP',
    'Hostname',
    'Latency Min (ms)',
    'Latency Avg (ms)',
    'Latency Max (ms)',
    'Packet Loss (%)',
    'Problem Hop',
    'Source',
  ]

  const rows: (string | number | boolean | null)[][] = []
  for (const tr of detail.traceroutes) {
    for (const hop of tr.hops) {
      rows.push([
        tr.targetIp,
        hop.hopNumber,
        hop.ip,
        hop.hostname,
        hop.latencyMin,
        hop.latencyAvg,
        hop.latencyMax,
        hop.packetLoss,
        hop.isProblemHop,
        hop.source,
      ])
    }
  }

  const safeName = detail.gameName.replace(/[^a-zA-Z0-9-_]/g, '_')
  try {
    const saved = await saveWithDialog(
      `gameroute-session-${detail.id}-${safeName}.csv`,
      toCsv(headers, rows),
    )
    if (saved) toast.success(m.export_csv_saved())
  } catch {
    toast.error(m.export_csv_error())
  }
}

export async function exportServerStability(servers: ServerStability[]) {
  const headers = ['IP', 'ASN', 'ISP', 'Country', 'Avg Latency (ms)', 'Avg Loss (%)', 'Traceroutes', 'Problem %', 'Game Server']
  const rows = servers.map(s => [
    s.ip,
    s.asn,
    s.isp,
    s.country,
    s.avgLatency != null ? Number(s.avgLatency.toFixed(1)) : null,
    s.avgPacketLoss != null ? Number(s.avgPacketLoss.toFixed(0)) : null,
    s.tracerouteCount,
    Number((s.problemHopRatio * 100).toFixed(0)),
    s.isGameServer,
  ])

  try {
    const saved = await saveWithDialog('gameroute-server-stability.csv', toCsv(headers, rows))
    if (saved) toast.success(m.export_csv_saved())
  } catch {
    toast.error(m.export_csv_error())
  }
}

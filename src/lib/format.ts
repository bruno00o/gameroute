export function formatDuration(seconds: number): string {
  if (seconds < 0) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s}s`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function computeDurationSecs(startedAt: string, endedAt: string | null): number {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  return Math.floor((end - start) / 1000)
}

export function latencyColor(ms: number | null): string {
  if (ms == null) return ''
  if (ms < 30) return 'text-emerald-500'
  if (ms < 80) return 'text-amber-500'
  return 'text-destructive'
}

export function formatMs(ms: number | null): string {
  if (ms == null) return '-'
  return `${ms.toFixed(1)}`
}

export function formatLoss(loss: number | null): string {
  if (loss == null) return '-'
  return `${loss.toFixed(0)}%`
}

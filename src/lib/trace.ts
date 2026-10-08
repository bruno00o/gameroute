import * as m from '@/paraglide/messages'
import type { DbHop, TracedTarget, TracerouteHopEvent } from '@/types/backend'

export type TraceState = 'queued' | 'running' | 'done' | 'failed'

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i

function isIpv6(value: string): boolean {
  if (!value.includes(':')) return false
  try {
    new URL(`http://[${value}]`)
    return true
  } catch {
    return false
  }
}

function isHostName(value: string): boolean {
  const host = value.endsWith('.') ? value.slice(0, -1) : value
  if (host.length > 253 || !host.includes('.')) return false
  if (/^[\d.]+$/.test(host)) return false
  return host.split('.').every(label => HOST_LABEL.test(label))
}

export function isValidTraceAddress(input: string): boolean {
  const value = input.trim()
  return IPV4.test(value) || isIpv6(value) || isHostName(value)
}

export function liveHopToDbHop(hop: TracerouteHopEvent): DbHop {
  return {
    id: hop.hopNumber,
    tracerouteId: 0,
    hopNumber: hop.hopNumber,
    ip: hop.ip,
    hostname: hop.hostname,
    latencyMin: hop.rttMin,
    latencyAvg: hop.timeout ? null : hop.rttMs,
    latencyMax: hop.rttMax,
    packetLoss: hop.packetLoss,
    isProblemHop: false,
    source: null,
    lossStatus: null,
  }
}

export function targetRoleLabel(target: TracedTarget | undefined): string {
  switch (target?.kind) {
    case 'game':
      return m.trace_role_game()
    case 'voice':
      return m.trace_role_voice()
    case 'other':
      return m.trace_role_other()
    default:
      return m.trace_role_manual()
  }
}

export function targetPortLabel(target: TracedTarget | undefined): string | null {
  if (!target || target.port <= 0) return null
  return `${target.protocol} ${target.port}`
}

const stateLabels: Record<TraceState, () => string> = {
  queued: m.trace_state_queued,
  running: m.trace_state_running,
  done: m.trace_state_done,
  failed: m.trace_state_failed,
}

export function traceStateLabel(state: TraceState): string {
  return stateLabels[state]()
}

export function traceState({
  hops,
  result,
  current,
}: {
  hops: number
  result: { success: boolean } | undefined
  current: boolean
}): TraceState {
  if (result) return result.success ? 'done' : 'failed'
  return current || hops > 0 ? 'running' : 'queued'
}

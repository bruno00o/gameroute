import { useMemo, useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { useAsnResolution } from '@/hooks/use-asn-resolution'
import { cancelTraceroute, getIgnoredConnectionCount, traceAddress } from '@/lib/tauri'
import { shortOperatorName } from '@/lib/operators'
import { hopCount, routeMapPoints } from '@/lib/route'
import {
  isValidTraceAddress,
  liveHopToDbHop,
  targetPortLabel,
  targetRoleLabel,
  traceState,
  traceStateLabel,
} from '@/lib/trace'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useTraceStore, type TraceResult } from '@/stores/trace-store'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { EmptyState } from '@/components/empty-state'
import { LiveBadge } from '@/components/live-badge'
import { Panel } from '@/components/panel'
import { HopList } from '@/components/route/hop-list'
import { RouteMap } from '@/components/route/route-map'
import { RouteStrip } from '@/components/route/route-strip'
import { SessionHeader } from '@/components/session/session-screen'
import { StatusPill } from '@/components/status/status-pill'
import type { ResolvedIpData } from '@/types/backend'

export const Route = createFileRoute('/trace')({
  component: TracePage,
})

const IGNORED_REFRESH_MS = 10_000

function counted(
  count: number,
  one: typeof m.trace_targets_one,
  other: typeof m.trace_targets_one
) {
  const params = { count: String(count) }
  return count === 1 ? one(params) : other(params)
}

function operatorOf(data: ResolvedIpData | undefined): string | null {
  return shortOperatorName(data?.asnInfo.org ?? data?.asnInfo.isp)
}

function TracePage() {
  const isRunning = useTraceStore(s => s.isRunning)
  const serverIps = useTraceStore(s => s.serverIps)
  const reset = useTraceStore(s => s.reset)
  const { data: asnData } = useAsnResolution(serverIps)

  const handleCancel = async () => {
    await cancelTraceroute().catch(() => undefined)
    reset()
    toast.info(m.trace_cancelled())
  }

  const actions = isRunning ? (
    <>
      <LiveBadge state="measuring" label={m.trace_running_label()} />
      <Button size="sm" onClick={handleCancel}>
        {m.trace_cancel()}
      </Button>
    </>
  ) : serverIps.length > 0 ? (
    <Button size="sm" onClick={reset}>
      {m.trace_clear()}
    </Button>
  ) : null

  return (
    <div className="h-full overflow-y-auto">
      <SessionHeader
        title={m.trace_title()}
        facts={
          serverIps.length > 0
            ? [counted(serverIps.length, m.trace_targets_one, m.trace_targets_other)]
            : []
        }
        actions={actions}
      />
      <div className="grid gap-4 px-4 pt-5 pb-6 sm:px-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <ManualTrace />
          <IgnoredConnections />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {serverIps.length === 0 ? (
            <Panel>
              <EmptyState title={m.trace_empty_title()}>{m.trace_empty_body()}</EmptyState>
            </Panel>
          ) : (
            serverIps.map(ip => (
              <TargetPanel key={ip} ip={ip} operator={operatorOf(asnData.get(ip))} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function ManualTrace() {
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValidTraceAddress(address)) {
      setError(m.trace_manual_invalid())
      return
    }
    setError(null)
    setPending(true)
    try {
      await traceAddress(address.trim())
      setAddress('')
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : null
      if (code === 'INVALID_ADDRESS') setError(m.trace_manual_invalid())
      else if (code === 'UNRESOLVED_ADDRESS') setError(m.trace_manual_unresolved())
      else toast.error(m.trace_manual_error())
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel label={m.trace_manual_label()} tone="sunken">
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-3">
        <TextField
          label={m.trace_manual_field()}
          mono
          placeholder="162.249.72.1"
          autoComplete="off"
          spellCheck={false}
          value={address}
          hint={m.trace_manual_hint()}
          error={error}
          onChange={event => {
            setAddress(event.target.value)
            setError(null)
          }}
        />
        <div>
          <Button type="submit" size="sm" loading={pending}>
            {m.trace_manual_submit()}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function IgnoredConnections() {
  const sessionId = useMonitoringStore(s => s.currentSessionId)
  const isMonitoring = useMonitoringStore(s => s.isMonitoring)
  const targetCount = useTraceStore(s => s.serverIps.length)

  const { data: count } = useQuery({
    queryKey: ['trace', 'ignored', sessionId, targetCount],
    queryFn: () => getIgnoredConnectionCount(sessionId!),
    enabled: sessionId != null,
    refetchInterval: isMonitoring ? IGNORED_REFRESH_MS : false,
  })

  if (!count) return null

  return (
    <Panel
      label={m.trace_ignored_label()}
      title={counted(count, m.trace_ignored_count_one, m.trace_ignored_count_other)}
    >
      <p className="text-ui text-muted-foreground max-w-[60ch]">{m.trace_ignored_body()}</p>
    </Panel>
  )
}

function TargetPanel({ ip, operator }: { ip: string; operator: string | null }) {
  const target = useTraceStore(s => s.targets.get(ip))
  const live = useTraceStore(s => s.liveHops.get(ip))
  const result = useTraceStore(s => s.results.get(ip))
  const current = useTraceStore(s => s.progress?.currentIp === ip)
  const advancedMode = useSettingsStore(s => s.advancedMode)

  const liveHops = useMemo(() => (live ?? []).map(liveHopToDbHop), [live])
  const state = traceState({ hops: liveHops.length, result, current })
  const hopsCount = result ? result.hops.length : liveHops.length
  const name = shortOperatorName(result?.route?.destinationName) ?? operator

  const label = [targetRoleLabel(target), name].filter(Boolean).join(' · ')
  const title = [
    ip,
    targetPortLabel(target),
    traceStateLabel(state),
    hopsCount > 0 ? hopCount(hopsCount) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Panel
      label={label}
      title={title}
      data-state={state}
      action={result && result.status !== 'unmeasured' && <StatusPill status={result.status} />}
    >
      {state === 'queued' ? (
        <p className="text-ui text-muted-foreground">{m.trace_queued_body()}</p>
      ) : state === 'failed' ? (
        <p className="text-ui text-muted-foreground">{m.trace_failed_body()}</p>
      ) : result ? (
        <TraceResultBody
          ip={ip}
          result={result}
          name={name ?? ip}
          mode={advancedMode ? 'detail' : 'simple'}
        />
      ) : (
        <HopList
          hops={liveHops}
          targetIp={ip}
          mode={advancedMode ? 'detail' : 'simple'}
          destinationName={name}
          pending
        />
      )}
    </Panel>
  )
}

function TraceResultBody({
  ip,
  result,
  name,
  mode,
}: {
  ip: string
  result: TraceResult
  name: string
  mode: 'simple' | 'detail'
}) {
  const [showMap, setShowMap] = useState(false)
  const { route, hops } = result
  const ips = useMemo(() => [...new Set([ip, ...hops.flatMap(hop => hop.ip ?? [])])], [ip, hops])
  const { data: asnData } = useAsnResolution(ips)
  const points = useMemo(() => routeMapPoints(hops, ip, asnData), [hops, ip, asnData])
  const lastHop = route && hops.find(hop => hop.hopNumber === route.lastRespondingHop)

  return (
    <>
      {route && (
        <RouteStrip
          className="mb-4"
          route={route}
          destination={{ name, detail: ip }}
          persistentLoss={lastHop?.lossStatus ? lastHop.packetLoss : null}
        />
      )}
      <HopList hops={hops} targetIp={ip} route={route} mode={mode} destinationName={name} />
      {points.length > 0 && (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showMap}
            onClick={() => setShowMap(open => !open)}
          >
            {showMap ? m.route_hide_map() : m.route_show_map()}
          </Button>
          {showMap && <RouteMap className="mt-3" points={points} />}
        </div>
      )}
    </>
  )
}

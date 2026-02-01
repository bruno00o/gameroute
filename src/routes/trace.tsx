import { useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  RiRouteLine,
  RiStopLine,
  RiTimeLine,
} from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { cancelTraceroute } from '@/lib/tauri'
import { useTraceStore } from '@/stores/trace-store'
import { LiveHopTable } from '@/components/live-hop-table'
import type { TracerouteHopEvent } from '@/types/backend'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'

export const Route = createFileRoute('/trace')({
  component: TracePage,
})

function TracePage() {
  const isRunning = useTraceStore(s => s.isRunning)
  const summary = useTraceStore(s => s.summary)

  if (isRunning) return <TraceRunningState />
  if (summary) return <TraceCompleteState />
  return <TraceIdleState />
}

function TraceIdleState() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <h1 className="text-2xl font-bold">{m.page_trace_title()}</h1>
      <p className="text-muted-foreground mt-2">{m.page_trace_description()}</p>
      <div className="mt-16 flex flex-col items-center gap-3 text-center">
        <RiRouteLine className="text-muted-foreground size-10" />
        <h2 className="text-lg font-medium">{m.trace_idle_title()}</h2>
        <p className="text-muted-foreground max-w-sm text-sm">{m.trace_idle_description()}</p>
      </div>
    </div>
  )
}

function TraceRunningState() {
  const progress = useTraceStore(s => s.progress)
  const serverIps = useTraceStore(s => s.serverIps)
  const reset = useTraceStore(s => s.reset)

  const handleCancel = useCallback(async () => {
    try {
      await cancelTraceroute()
    } catch {
      // Backend reset failed — still reset frontend
    }
    reset()
    toast.info(m.trace_cancel())
  }, [reset])

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="flex items-start justify-between gap-4">
        <TraceHeader
          title={m.trace_running()}
          subtitle={
            progress
              ? m.trace_ip_progress({
                  current: String(progress.currentIndex + 1),
                  total: String(progress.totalCount),
                })
              : undefined
          }
        />
        <Button variant="outline" size="sm" onClick={handleCancel}>
          <RiStopLine className="size-3.5" data-icon="inline-start" />
          {m.trace_cancel()}
        </Button>
      </div>
      {progress && (
        <Progress value={progress.progress} className="mt-3">
          <ProgressLabel className="sr-only">{m.trace_running()}</ProgressLabel>
          <ProgressValue />
        </Progress>
      )}
      {serverIps.length > 0 && (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <TraceIpList serverIps={serverIps} />
        </div>
      )}
    </div>
  )
}

function TraceCompleteState() {
  const summary = useTraceStore(s => s.summary)
  const serverIps = useTraceStore(s => s.serverIps)
  const reset = useTraceStore(s => s.reset)

  if (!summary) return null

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <TraceHeader title={m.trace_complete()} />
      <div className="mt-3 flex items-center gap-3">
        <Badge variant="secondary">
          {m.trace_successful({ count: String(summary.successful) })}
        </Badge>
        {summary.failed > 0 && (
          <Badge variant="destructive">{m.trace_failed({ count: String(summary.failed) })}</Badge>
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={reset}>
          {m.trace_clear()}
        </Button>
      </div>
      {serverIps.length > 0 && (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <TraceIpList serverIps={serverIps} />
        </div>
      )}
    </div>
  )
}

function TraceHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
    </div>
  )
}

function TraceIpList({ serverIps }: { serverIps: string[] }) {
  const liveHops = useTraceStore(s => s.liveHops)
  const completedIps = useTraceStore(s => s.completedIps)
  const progress = useTraceStore(s => s.progress)

  return (
    <div className="space-y-2">
      {serverIps.map(ip => {
        const hops = liveHops.get(ip) ?? []
        const completed = completedIps.get(ip)
        const isCurrent = progress?.currentIp === ip
        const defaultOpen = isCurrent || completed !== undefined

        return (
          <TraceIpCollapsible
            key={ip}
            ip={ip}
            hops={hops}
            completed={completed}
            isCurrent={isCurrent}
            defaultOpen={defaultOpen}
          />
        )
      })}
    </div>
  )
}

function TraceIpCollapsible({
  ip,
  hops,
  completed,
  isCurrent,
  defaultOpen,
}: {
  ip: string
  hops: TracerouteHopEvent[]
  completed: boolean | undefined
  isCurrent: boolean
  defaultOpen: boolean
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="ring-foreground/10 hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2.5 ring-1 transition-colors">
        <IpStatusIcon completed={completed} isCurrent={isCurrent} />
        <span className="font-mono text-sm">{ip}</span>
        <span className="text-muted-foreground text-xs">
          <IpStatusLabel completed={completed} isCurrent={isCurrent} hopsCount={hops.length} />
        </span>
        <RiArrowDownSLine className="text-muted-foreground ml-auto size-4 transition-transform [[data-panel-open]_&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="ring-foreground/10 ring-1 ring-t-0">
        {hops.length > 0 ? (
          <LiveHopTable hops={hops} />
        ) : (
          <div className="text-muted-foreground py-6 text-center text-sm">{m.trace_pending()}</div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function IpStatusIcon({
  completed,
  isCurrent,
}: {
  completed: boolean | undefined
  isCurrent: boolean
}) {
  if (completed === true) {
    return <RiCheckLine className="size-4 shrink-0 text-emerald-500" />
  }
  if (completed === false) {
    return <RiCloseLine className="text-destructive size-4 shrink-0" />
  }
  if (isCurrent) {
    return <RiLoader4Line className="size-4 shrink-0 animate-spin" />
  }
  return <RiTimeLine className="text-muted-foreground size-4 shrink-0" />
}

function IpStatusLabel({
  completed,
  isCurrent,
  hopsCount,
}: {
  completed: boolean | undefined
  isCurrent: boolean
  hopsCount: number
}) {
  if (completed === true) {
    return (
      <>
        {m.trace_status_success()}
        {hopsCount > 0 && ` · ${m.trace_hops_count({ count: String(hopsCount) })}`}
      </>
    )
  }
  if (completed === false) {
    return <>{m.trace_status_failed()}</>
  }
  if (isCurrent) {
    return (
      <>
        {m.trace_status_in_progress()}
        {hopsCount > 0 && ` · ${m.trace_hops_count({ count: String(hopsCount) })}`}
      </>
    )
  }
  return <>{m.trace_pending()}</>
}

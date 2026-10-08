import { useState } from 'react'
import { RiPlayFill, RiStopFill, RiUserLine } from '@remixicon/react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { friendlyError } from '@/lib/errors'
import { monitorLabel, type LiveState } from '@/lib/live-state'
import { startMonitoring, stopMonitoring } from '@/lib/tauri'
import { cn } from '@/lib/utils'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { LiveBadge, LiveOrb } from '@/components/live-badge'
import { ProcessSelector } from '@/components/process-selector'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function SidebarMonitor({ liveState }: { liveState: LiveState }) {
  const { state: sidebarState, toggleSidebar } = useSidebar()
  const isMonitoring = useMonitoringStore(s => s.isMonitoring)
  const isManualMode = useMonitoringStore(s => s.isManualMode)
  const gameName = useMonitoringStore(s => s.currentGame?.gameName)
  const sessionId = useMonitoringStore(s => s.currentSessionId)
  const server = useMonitoringStore(s => s.lastServer)
  const [processOpen, setProcessOpen] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

  const label = monitorLabel({ liveState, isMonitoring, isManualMode })

  const handleToggle = async () => {
    setIsToggling(true)
    try {
      if (isMonitoring) {
        await stopMonitoring()
        useMonitoringStore.getState().reset()
      } else {
        await startMonitoring()
        useMonitoringStore.setState({ isMonitoring: true })
      }
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setIsToggling(false)
    }
  }

  if (sidebarState === 'collapsed') {
    const summary = gameName ? `${label} · ${gameName}` : label

    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={summary}
              onClick={toggleSidebar}
              className={cn(
                'bg-surface-sunken text-muted-foreground mx-auto flex size-8 cursor-pointer items-center justify-center rounded-sm border',
                liveState === 'live' && 'text-signal'
              )}
            />
          }
        >
          <LiveOrb state={liveState} />
        </TooltipTrigger>
        <TooltipContent side="right">{summary}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      data-slot="sidebar-monitor"
      className="bg-surface-sunken flex flex-col items-start gap-1.5 rounded-sm border p-3"
    >
      <LiveBadge state={liveState} label={label} />
      {isMonitoring && (
        <p
          className={cn(
            'text-ui min-w-0 font-semibold break-words',
            !gameName && 'text-muted-foreground font-normal'
          )}
        >
          {gameName && sessionId ? (
            <Link
              to="/sessions/$id"
              params={{ id: String(sessionId) }}
              search={{ period: undefined }}
              className="hover:underline"
            >
              {gameName}
            </Link>
          ) : (
            (gameName ?? m.monitoring_no_game())
          )}
        </p>
      )}
      {gameName &&
        (server ? (
          <p className="text-data-sm text-ink-subtle -mt-1 font-mono break-all">
            {server.ip} · {server.protocol.toUpperCase()} {server.port}
          </p>
        ) : (
          <p className="text-label text-ink-subtle -mt-1">{m.monitoring_waiting_match()}</p>
        ))}
      <div className="mt-1 flex w-full gap-1.5">
        <Button
          variant={isMonitoring ? 'secondary' : 'primary'}
          size="sm"
          className="flex-1"
          loading={isToggling}
          onClick={handleToggle}
        >
          {isMonitoring ? <RiStopFill /> : <RiPlayFill />}
          {isMonitoring ? m.monitoring_stop() : m.monitoring_start()}
        </Button>
        {!isMonitoring && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  onClick={() => setProcessOpen(true)}
                  aria-label={m.monitoring_manual_select()}
                />
              }
            >
              <RiUserLine />
            </TooltipTrigger>
            <TooltipContent>{m.monitoring_manual_select()}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <ProcessSelector open={processOpen} onOpenChange={setProcessOpen} />
    </div>
  )
}

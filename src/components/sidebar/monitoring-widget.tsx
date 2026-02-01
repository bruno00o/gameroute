import { useCallback, useState } from 'react'
import { RiGamepadLine, RiPlayLine, RiStopLine, RiUserLine } from '@remixicon/react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { startMonitoring, stopMonitoring } from '@/lib/tauri'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ProcessSelector } from '@/components/process-selector'

export function MonitoringWidget() {
  const { state: sidebarState } = useSidebar()
  const { isMonitoring, currentGame, isManualMode, serverIpCount, currentSessionId } =
    useMonitoringStore()
  const [processOpen, setProcessOpen] = useState(false)

  const handleToggle = useCallback(async () => {
    try {
      if (isMonitoring) {
        await stopMonitoring()
        useMonitoringStore.setState({
          isMonitoring: false,
          currentGame: null,
          isManualMode: false,
          capturedIps: [],
          serverIpCount: 0,
          currentSessionId: null,
        })
      } else {
        await startMonitoring()
        useMonitoringStore.setState({ isMonitoring: true })
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? (e as { message: string }).message : String(e)
      toast.error(message)
    }
  }, [isMonitoring])

  const collapsed = sidebarState === 'collapsed'

  if (collapsed) {
    return (
      <div className="mb-1 flex justify-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={handleToggle}
                className="ring-sidebar-border relative flex size-8 items-center justify-center rounded-none ring-1 cursor-pointer"
              />
            }
          >
            <RiGamepadLine className="size-4" />
            <span
              className={cn(
                'absolute right-0.5 top-0.5 size-2 rounded-full',
                isMonitoring ? 'bg-emerald-500' : 'bg-muted-foreground/40'
              )}
            />
          </TooltipTrigger>
          <TooltipContent side="right">
            {isMonitoring
              ? currentGame
                ? currentGame.gameName
                : m.monitoring_scanning()
              : m.monitoring_idle()}
          </TooltipContent>
        </Tooltip>
      </div>
    )
  }

  return (
    <>
      <div className="ring-sidebar-border mb-2 flex flex-col gap-2 rounded-none p-2.5 ring-1 mx-1.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              isMonitoring ? 'bg-emerald-500' : 'bg-muted-foreground/40'
            )}
          />
          <div className="min-w-0 flex-1">
            {isMonitoring ? (
              currentGame ? (
                <>
                  <p className="truncate text-xs font-medium">
                    {currentSessionId ? (
                      <Link
                        to="/sessions/$id"
                        params={{ id: String(currentSessionId) }}
                        search={{ period: undefined }}
                        className="hover:underline"
                      >
                        {currentGame.gameName}
                      </Link>
                    ) : (
                      currentGame.gameName
                    )}
                  </p>
                  <p className="text-muted-foreground text-[10px]">
                    {isManualMode ? m.monitoring_manual() : m.monitoring_detected()}
                    {serverIpCount > 0 &&
                      ` · ${m.monitoring_ips({ count: String(serverIpCount) })}`}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">{m.monitoring_scanning()}</p>
              )
            ) : (
              <p className="text-muted-foreground text-xs">{m.monitoring_idle()}</p>
            )}
          </div>
        </div>

        <div className="flex gap-1">
          <Button
            variant={isMonitoring ? 'destructive' : 'default'}
            size="xs"
            className="flex-1"
            onClick={handleToggle}
          >
            {isMonitoring ? (
              <RiStopLine className="size-3" data-icon="inline-start" />
            ) : (
              <RiPlayLine className="size-3" data-icon="inline-start" />
            )}
            {isMonitoring ? m.monitoring_stop() : m.monitoring_start()}
          </Button>
          {!isMonitoring && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="outline" size="icon-xs" onClick={() => setProcessOpen(true)} />
                }
              >
                <RiUserLine className="size-3" />
              </TooltipTrigger>
              <TooltipContent>{m.monitoring_manual()}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <ProcessSelector open={processOpen} onOpenChange={setProcessOpen} />
    </>
  )
}

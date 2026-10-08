import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RiSearchLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { RunningApp } from '@/types/backend'
import { friendlyError } from '@/lib/errors'
import { formatNumber } from '@/lib/format'
import { listRunningApps, startManualMonitoring } from '@/lib/tauri'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TextField } from '@/components/ui/text-field'
import { EmptyState } from '@/components/empty-state'

function udpLabel(app: RunningApp) {
  if (app.udpSockets === 0) return m.process_selector_no_udp()
  const label = app.udpSockets === 1 ? m.process_selector_udp_one : m.process_selector_udp_other
  return label({ count: formatNumber(app.udpSockets) })
}

export function ProcessSelector({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')
  const [selectedPid, setSelectedPid] = useState<number | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ['running-apps'],
    queryFn: listRunningApps,
    enabled: open,
    staleTime: 0,
  })

  const filtered = search
    ? apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : apps
  const selected = apps.find(app => app.pid === selectedPid) ?? null

  const handleStart = async () => {
    if (!selected) return
    setIsStarting(true)
    try {
      await startManualMonitoring(selected.pid)
      onOpenChange(false)
    } catch (e) {
      toast.error(friendlyError(e))
    } finally {
      setIsStarting(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setSearch('')
      setSelectedPid(null)
    }
    onOpenChange(next)
  }

  const total = (apps.length === 1 ? m.process_selector_total_one : m.process_selector_total_other)(
    { count: formatNumber(apps.length) }
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{m.process_selector_title()}</DialogTitle>
          <DialogDescription>{m.process_selector_description()}</DialogDescription>
        </DialogHeader>
        <TextField
          prefix={<RiSearchLine />}
          aria-label={m.process_selector_search()}
          placeholder={m.process_selector_search()}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <ScrollArea className="border-line h-64 overflow-hidden rounded-sm border">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-xs">{m.monitoring_scanning()}</div>
          ) : filtered.length === 0 ? (
            <EmptyState compact className="p-4" title={m.process_selector_empty()} />
          ) : (
            <ul aria-label={m.process_selector_list()} className="divide-line divide-y">
              {filtered.map(app => (
                <li key={app.pid}>
                  <label
                    className={cn(
                      'hover:bg-accent grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5',
                      app.pid === selectedPid && 'bg-accent'
                    )}
                  >
                    <input
                      type="radio"
                      name="running-app"
                      className="accent-primary m-0"
                      checked={app.pid === selectedPid}
                      onChange={() => setSelectedPid(app.pid)}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-data truncate font-mono">{app.name}</span>
                      <span className="text-data-sm text-muted-foreground truncate font-mono">
                        {[
                          `${m.process_selector_pid()} ${app.pid}`,
                          app.processCount > 1
                            ? m.process_selector_count({ count: String(app.processCount) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'text-label whitespace-nowrap',
                        app.udpSockets === 0 && 'text-muted-foreground'
                      )}
                    >
                      {udpLabel(app)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        {!isLoading && (
          <p className="text-data-sm text-muted-foreground font-mono tabular-nums">{total}</p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>
            {m.process_selector_cancel()}
          </DialogClose>
          <Button variant="primary" disabled={!selected} loading={isStarting} onClick={handleStart}>
            {m.process_selector_submit({ name: selected?.name ?? '' }).trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

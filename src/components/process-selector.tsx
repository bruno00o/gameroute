import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RiSearchLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { friendlyError } from '@/lib/errors'
import { listRunningApps, startManualMonitoring } from '@/lib/tauri'
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

export function ProcessSelector({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [search, setSearch] = useState('')

  const { data: apps = [], isLoading } = useQuery({
    queryKey: ['running-apps'],
    queryFn: listRunningApps,
    enabled: open,
    staleTime: 0,
  })

  const filtered = search
    ? apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : apps

  const handleSelect = async (pid: number) => {
    try {
      await startManualMonitoring(pid)
      onOpenChange(false)
    } catch (e) {
      toast.error(friendlyError(e))
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (next) setSearch('')
    onOpenChange(next)
  }

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
        <ScrollArea className="h-64 overflow-hidden">
          {isLoading ? (
            <div className="text-muted-foreground p-4 text-center text-xs">
              {m.monitoring_scanning()}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState compact className="p-4" title={m.process_selector_empty()} />
          ) : (
            <div className="space-y-0.5">
              {filtered.map(app => (
                <button
                  key={app.pid}
                  onClick={() => handleSelect(app.pid)}
                  className="hover:bg-muted flex w-full items-center gap-3 rounded-none px-2 py-1.5 text-left cursor-pointer transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{app.name}</p>
                    {app.path && (
                      <p className="text-muted-foreground truncate text-[10px]">{app.path}</p>
                    )}
                  </div>
                  {app.processCount > 1 && (
                    <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
                      {m.process_selector_count({ count: String(app.processCount) })}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <DialogClose render={<Button />}>{m.process_selector_cancel()}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

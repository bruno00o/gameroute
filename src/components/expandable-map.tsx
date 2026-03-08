import { useState, type ReactNode } from 'react'
import { RiFullscreenLine } from '@remixicon/react'

import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'

export function ExpandableMap({
  children,
  renderExpanded,
  className,
}: {
  children: ReactNode
  renderExpanded?: () => ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className={`relative ${className ?? ''}`}>
        {children}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-md bg-background/80 text-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur-sm transition-colors hover:bg-background"
        >
          <RiFullscreenLine className="size-3.5" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[70vh] w-[85vw] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
          <div className="h-full w-full">
            {open && (renderExpanded ? renderExpanded() : children)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { useState } from 'react'
import { RiDownloadLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import {
  dismissUpdate,
  installUpdate,
  RELEASE_NOTES_SHOWN,
  releaseNotes,
  releaseUrl,
  useUpdateStore,
} from '@/lib/updater'
import { openExternalUrl } from '@/lib/tauri'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Notice } from '@/components/notice'

export function UpdateDialog() {
  const update = useUpdateStore(s => s.pending)
  const game = useMonitoringStore(s => s.currentGame?.gameName)
  const [installing, setInstalling] = useState(false)

  const handleInstall = async () => {
    setInstalling(true)
    try {
      await installUpdate()
    } catch {
      toast.error(m.updater_error())
      dismissUpdate()
    } finally {
      setInstalling(false)
    }
  }

  const notes = releaseNotes(update?.body)
  const shown = notes.slice(0, RELEASE_NOTES_SHOWN)
  const hidden = notes.length - shown.length

  return (
    <Dialog
      open={update !== null}
      onOpenChange={open => {
        if (!open && !installing) dismissUpdate()
      }}
    >
      <DialogContent showCloseButton={false} className="gap-3.5 sm:max-w-md">
        {update && (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-data-sm text-muted-foreground font-mono tabular-nums">
                {update.currentVersion} → {update.version}
              </p>
              <DialogTitle className="text-heading text-foreground">
                {m.updater_title({ version: update.version })}
              </DialogTitle>
            </div>
            {shown.length > 0 && (
              <ul className="text-ui text-foreground flex list-disc flex-col gap-1.5 pl-[18px]">
                {shown.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            <p className="text-label text-muted-foreground flex flex-wrap gap-x-3 font-normal">
              {hidden > 0 && (
                <span>
                  {hidden === 1
                    ? m.updater_more_one({ count: String(hidden) })
                    : m.updater_more_other({ count: String(hidden) })}
                </span>
              )}
              <button
                type="button"
                className="text-foreground decoration-line-strong hover:decoration-foreground cursor-pointer underline underline-offset-4"
                onClick={() => openExternalUrl(releaseUrl(update.version)).catch(() => undefined)}
              >
                {m.updater_all_notes()}
              </button>
            </p>
            {game ? (
              <Notice tone="watch">{m.updater_match_warning({ game })}</Notice>
            ) : (
              <p className="text-label text-muted-foreground font-normal">{m.updater_no_match()}</p>
            )}
            <DialogFooter className="border-t pt-3.5">
              <Button variant="ghost" disabled={installing} onClick={dismissUpdate}>
                {m.updater_later()}
              </Button>
              <Button variant="primary" loading={installing} onClick={handleInstall}>
                <RiDownloadLine data-icon="inline-start" />
                {m.updater_update_now()}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

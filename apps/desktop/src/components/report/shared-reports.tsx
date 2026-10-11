import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiDeleteBinLine, RiExternalLinkLine, RiFileCopyLine } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { SharedReport } from '@/types/backend'
import { formatDay } from '@/lib/format'
import { shareErrorMessage } from '@/lib/share'
import { deleteSharedReport, listSharedReports } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { copyLink, openLink, SHARED_REPORTS_KEY } from '@/components/report/share-dialog'

export function SharedReports() {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState<SharedReport | null>(null)
  const { data: reports, isError } = useQuery({
    queryKey: SHARED_REPORTS_KEY,
    queryFn: listSharedReports,
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteSharedReport(id),
    onSuccess: () => toast.success(m.share_deleted()),
    onError: err => toast.error(shareErrorMessage(err)),
    onSettled: () => {
      setConfirming(null)
      queryClient.invalidateQueries({ queryKey: SHARED_REPORTS_KEY })
    },
  })

  if (!isError && !reports?.length) return null

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-label text-muted-foreground font-stretch-[92%]">
        {m.shared_list_label()}
      </h2>
      {isError ? (
        <p className="text-data-sm text-muted-foreground">{m.shared_list_error()}</p>
      ) : (
        <ul className="bg-card flex flex-col rounded-sm border">
          {reports!.map(report => (
            <li
              key={report.id}
              data-slot="shared-report"
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 border-b px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="text-ui text-foreground block truncate">{report.gameName}</span>
                <span className="text-data-sm text-muted-foreground block truncate">
                  {m.shared_list_dates({
                    date: formatDay(report.createdAt),
                    expiry: formatDay(report.expiresAt),
                  })}
                </span>
                <span className="text-data-sm text-muted-foreground block truncate font-mono">
                  {report.url}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.share_copy_link()}
                  onClick={() => copyLink(report.url)}
                >
                  <RiFileCopyLine />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.share_open()}
                  onClick={() => openLink(report.url)}
                >
                  <RiExternalLinkLine />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.share_delete()}
                  onClick={() => setConfirming(report)}
                >
                  <RiDeleteBinLine />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={confirming != null}
        onOpenChange={open => !open && !remove.isPending && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.shared_delete_title()}</AlertDialogTitle>
            <AlertDialogDescription>{m.shared_delete_description()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{m.share_cancel()}</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              loading={remove.isPending}
              onClick={() => confirming && remove.mutate(confirming.id)}
            >
              {m.share_delete()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiShareForwardLine,
} from '@remixicon/react'
import { getVersion } from '@tauri-apps/api/app'
import {
  REPORT_GAMES,
  REPORT_TTL_DAYS,
  type ReportMatch,
  type ReportPayload,
} from '@gameroute/shared'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { SharedReportLink } from '@/types/backend'
import { formatClock, formatDay } from '@/lib/format'
import { formatLoss, severityLabel } from '@/lib/matches'
import type { ReportRecipient, ReportSource } from '@/lib/report'
import { formatRouteMs, zoneLabel } from '@/lib/route'
import { prepareShare, sharedAddresses, sharedOperators, shareErrorMessage } from '@/lib/share'
import {
  deleteSharedReport,
  getSeverityThresholds,
  openExternalUrl,
  shareReport,
} from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SwitchField } from '@/components/ui/switch'
import { Notice } from '@/components/notice'
import { StatusPill } from '@/components/status/status-pill'

export const SHARED_REPORTS_KEY = ['shared-reports']

export type ShareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: ReportSource[]
  recipient: ReportRecipient
  recipientLabel: string
  route: boolean
  hops: boolean
}

export function ShareDialog({ open, onOpenChange, ...props }: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] gap-4 overflow-y-auto sm:max-w-xl">
        {open && <ShareBody {...props} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ShareBody({
  sources,
  recipient,
  recipientLabel,
  route,
  hops,
  onClose,
}: Omit<ShareDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [exactTimes, setExactTimes] = useState(false)
  const [link, setLink] = useState<SharedReportLink | null>(null)

  const thresholds = useQuery({
    queryKey: ['severity-thresholds'],
    queryFn: getSeverityThresholds,
    staleTime: Infinity,
  })
  const version = useQuery({ queryKey: ['app-version'], queryFn: getVersion, staleTime: Infinity })

  const ready = !thresholds.isPending && version.data != null
  const check = useMemo(
    () =>
      ready
        ? prepareShare(sources, {
            recipient,
            exactTimes,
            appVersion: version.data,
            thresholds: thresholds.data,
            route,
            hops,
          })
        : null,
    [ready, sources, recipient, exactTimes, version.data, thresholds.data, route, hops]
  )

  const share = useMutation({
    mutationFn: (payload: ReportPayload) => shareReport(payload),
    onSuccess: result => {
      setLink(result)
      queryClient.invalidateQueries({ queryKey: SHARED_REPORTS_KEY })
    },
  })

  if (link) return <ShareDone link={link} onClose={onClose} />

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-heading text-foreground">{m.share_title()}</DialogTitle>
        <DialogDescription className="text-ui">
          {m.share_description({ days: String(REPORT_TTL_DAYS) })}
        </DialogDescription>
      </DialogHeader>

      {check?.ok === false ? (
        <Notice tone="critical" title={m.share_invalid()}>
          <ul className="text-data-sm mt-1 font-mono">
            {check.issues.map(issue => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Notice>
      ) : check?.ok ? (
        <SharePreview payload={check.payload} recipientLabel={recipientLabel} />
      ) : null}

      <SwitchField
        label={m.share_exact_times()}
        description={m.share_exact_times_hint()}
        checked={exactTimes}
        onCheckedChange={setExactTimes}
        disabled={share.isPending}
      />

      {check?.ok && (
        <Collapsible>
          <CollapsibleTrigger className="text-label text-muted-foreground hover:text-foreground group/raw flex items-center gap-1">
            <RiArrowDownSLine
              aria-hidden
              className="size-4 transition-transform group-data-[panel-open]/raw:rotate-180"
            />
            {m.share_raw()}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              data-slot="share-raw"
              tabIndex={0}
              className="text-data-sm text-foreground bg-card mt-2 max-h-64 overflow-auto rounded-sm border p-3 font-mono leading-5"
            >
              {JSON.stringify(check.payload, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {share.isError && <Notice tone="critical" title={shareErrorMessage(share.error)} />}

      <DialogFooter className="border-t pt-3.5">
        <Button variant="ghost" disabled={share.isPending} onClick={onClose}>
          {m.share_cancel()}
        </Button>
        <Button
          variant="primary"
          disabled={!check?.ok}
          loading={share.isPending}
          onClick={() => check?.ok && share.mutate(check.payload)}
        >
          <RiShareForwardLine data-icon="inline-start" />
          {m.share_confirm()}
        </Button>
      </DialogFooter>
    </>
  )
}

function matchPing(match: ReportMatch): string | null {
  if (match.pingMedianMs == null) return null
  const ping = formatRouteMs(match.pingMedianMs, match.pingAtLeast)
  const text =
    match.source === 'game'
      ? m.share_ping_game({ ping })
      : match.pingAtLeast && match.measuredUpToHop != null
        ? `${ping}, ${m.measured_up_to_hop({ hop: String(match.measuredUpToHop) })}`
        : ping
  return (match.lossPct ?? 0) > 0 ? `${text}, ${formatLoss(match.lossPct)}` : text
}

function SharePreview({
  payload,
  recipientLabel,
}: {
  payload: ReportPayload
  recipientLabel: string
}) {
  const { verdict, isp } = payload
  const operators = sharedOperators(payload)
  const addresses = sharedAddresses(payload)
  const ispText = isp
    ? [isp.name, isp.asn != null ? `AS${isp.asn}` : null].filter(Boolean).join(', ')
    : m.share_none()

  return (
    <section data-slot="share-preview" className="flex flex-col gap-3">
      <dl className="text-ui grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <PreviewRow label={m.share_game()}>{REPORT_GAMES[payload.gameSlug]}</PreviewRow>
        <PreviewRow label={m.share_verdict()}>
          {[severityLabel(verdict.status), verdict.zone ? zoneLabel(verdict.zone) : null]
            .filter(Boolean)
            .join(', ')}
        </PreviewRow>
        <PreviewRow label={m.share_isp()}>{ispText}</PreviewRow>
        <PreviewRow label={m.share_recipient()}>{recipientLabel}</PreviewRow>
        <PreviewRow label={m.share_operators()}>
          {operators.length > 0 ? operators.join(', ') : m.share_none()}
        </PreviewRow>
        <PreviewRow label={m.share_addresses()}>
          {addresses.length > 0 ? (
            <span className="font-mono break-all">{addresses.join(', ')}</span>
          ) : (
            m.share_none()
          )}
        </PreviewRow>
      </dl>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-label text-muted-foreground font-stretch-[92%]">{m.share_matches()}</h3>
        <ul className="bg-card flex max-h-48 flex-col overflow-y-auto rounded-sm border">
          {payload.matches.map((match, index) => (
            <li
              key={index}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 border-b px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="text-ui text-foreground block truncate">
                  {m.share_match_row({
                    number: String(match.number),
                    day: formatDay(match.startedAt),
                    time: formatClock(match.startedAt),
                  })}
                </span>
                {matchPing(match) && (
                  <span className="text-data-sm text-muted-foreground block truncate font-mono tabular-nums">
                    {matchPing(match)}
                  </span>
                )}
              </span>
              <StatusPill status={match.status} size="sm" />
            </li>
          ))}
        </ul>
      </div>

      <p className="text-label text-muted-foreground font-normal">{m.share_never()}</p>
    </section>
  )
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground min-w-0">{children}</dd>
    </>
  )
}

function ShareDone({ link, onClose }: { link: SharedReportLink; onClose: () => void }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => deleteSharedReport(link.id),
    onSuccess: () => {
      toast.success(m.share_deleted())
      queryClient.invalidateQueries({ queryKey: SHARED_REPORTS_KEY })
      onClose()
    },
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-heading text-foreground">{m.share_done_title()}</DialogTitle>
        <DialogDescription className="text-ui">
          {m.share_done_expires({ date: formatDay(link.expiresAt) })}
        </DialogDescription>
      </DialogHeader>
      <ReportLinkActions url={link.url} />
      {remove.isError && <Notice tone="critical" title={shareErrorMessage(remove.error)} />}
      <DialogFooter className="border-t pt-3.5 sm:justify-between">
        <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
          <RiDeleteBinLine data-icon="inline-start" />
          {m.share_delete()}
        </Button>
        <Button variant="primary" disabled={remove.isPending} onClick={onClose}>
          {m.share_close()}
        </Button>
      </DialogFooter>
    </>
  )
}

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success(m.share_link_copied())
  } catch {
    toast.error(m.export_llm_error())
  }
}

export function openLink(url: string) {
  openExternalUrl(url).catch(() => toast.error(m.share_error_generic()))
}

function ReportLinkActions({ url }: { url: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p
        data-slot="share-link"
        aria-label={m.share_link()}
        className="text-data-sm text-foreground bg-card rounded-sm border px-3 py-2 font-mono break-all select-all"
      >
        {url}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => copyLink(url)}>
          <RiFileCopyLine data-icon="inline-start" />
          {m.share_copy_link()}
        </Button>
        <Button size="sm" onClick={() => openLink(url)}>
          <RiExternalLinkLine data-icon="inline-start" />
          {m.share_open()}
        </Button>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiDownloadLine, RiFileCopyLine, RiFilePdf2Line } from '@remixicon/react'
import { save } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { formatClock, formatDay } from '@/lib/format'
import { flowServerName, formatFlowPing, formatLoss, matchMeasure } from '@/lib/matches'
import {
  defaultReportSelection,
  reportCandidateKey,
  reportIspName,
  reportPublisherName,
  reportDocument,
  renderReportText,
  type ReportCandidate,
  type ReportRecipient,
  type ReportSource,
} from '@/lib/report'
import {
  getSessionDetail,
  getSessionList,
  getSessionMatches,
  writeExportFile,
  writeExportPdf,
} from '@/lib/tauri'
import { cn, errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { SwitchField } from '@/components/ui/switch'
import { EmptyState } from '@/components/empty-state'
import { Notice } from '@/components/notice'
import { Panel } from '@/components/panel'
import { StatusPill } from '@/components/status/status-pill'

export const Route = createFileRoute('/reports')({
  component: ReportsPage,
  validateSearch: (search: Record<string, unknown>): { session?: number } => {
    const session = Number(search.session)
    return search.session != null && Number.isInteger(session) && session > 0 ? { session } : {}
  },
})

const SESSION_COUNT = 12
const MAX_MATCHES = 30
const STALE_MS = 60_000

type SessionRef = { id: number; gameName: string; startedAt: string }

function fileStamp(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0'))
    .join('-')
}

function useReportCandidates(focusSessionId?: number) {
  const queryClient = useQueryClient()
  const listQuery = useQuery({
    queryKey: ['reports', 'sessions'],
    queryFn: () => getSessionList({}, SESSION_COUNT, 0),
    staleTime: STALE_MS,
  })
  const items = listQuery.data?.items

  const focusInList = focusSessionId != null && items?.some(item => item.id === focusSessionId)
  const focusQuery = useQuery({
    queryKey: ['session', focusSessionId],
    queryFn: () => getSessionDetail(focusSessionId!),
    enabled: focusSessionId != null && items != null && !focusInList,
    staleTime: STALE_MS,
  })

  const sessions = useMemo<SessionRef[]>(() => {
    const listed = (items ?? []).filter(item => item.matchCount > 0)
    const focus = focusQuery.data
    return focus && !focusInList && !listed.some(item => item.id === focus.id)
      ? [focus, ...listed]
      : listed
  }, [items, focusQuery.data, focusInList])

  const matchResults = useQueries({
    queries: sessions.map(session => ({
      queryKey: ['session', session.id, 'matches'],
      queryFn: () => getSessionMatches(session.id),
      staleTime: STALE_MS,
    })),
    combine: results => ({
      data: results.map(result => result.data),
      pending: results.some(result => result.isPending),
      error: results.some(result => result.isError),
    }),
  })

  const candidates = useMemo<ReportCandidate[]>(() => {
    const all = sessions.flatMap((session, index) =>
      [...(matchResults.data[index] ?? [])].reverse().map(match => ({
        key: reportCandidateKey(session.id, match.number),
        sessionId: session.id,
        gameName: session.gameName,
        match,
      }))
    )
    return [
      ...all.filter(candidate => candidate.sessionId === focusSessionId),
      ...all.filter(candidate => candidate.sessionId !== focusSessionId),
    ]
  }, [sessions, matchResults.data, focusSessionId])

  return {
    candidates,
    isPending: listQuery.isPending || matchResults.pending,
    isError: listQuery.isError || matchResults.error,
    retry: () => {
      listQuery.refetch()
      queryClient.invalidateQueries({
        predicate: query => query.queryKey[0] === 'session' && query.queryKey[2] === 'matches',
      })
    },
  }
}

function ReportsPage() {
  const { session: focusSessionId } = Route.useSearch()
  const { candidates, isPending, isError, retry } = useReportCandidates(focusSessionId)

  const [recipient, setRecipient] = useState<ReportRecipient>('isp')
  const [route, setRoute] = useState(true)
  const [hops, setHops] = useState(true)
  const [addresses, setAddresses] = useState(false)
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [creatingPdf, setCreatingPdf] = useState(false)

  const defaults = useMemo(
    () => new Set(defaultReportSelection(candidates, focusSessionId)),
    [candidates, focusSessionId]
  )
  const selected = picked ?? defaults
  const visible = candidates.slice(0, MAX_MATCHES)
  const chosen = useMemo(
    () => candidates.filter(candidate => selected.has(candidate.key)),
    [candidates, selected]
  )
  const sessionIds = useMemo(
    () => [...new Set(chosen.map(candidate => candidate.sessionId))],
    [chosen]
  )
  const detailResults = useQueries({
    queries: sessionIds.map(id => ({
      queryKey: ['session', id],
      queryFn: () => getSessionDetail(id),
      staleTime: STALE_MS,
    })),
    combine: results => ({
      data: results.map(result => result.data),
      ready: results.every(result => result.isSuccess),
    }),
  })
  const detailsReady = detailResults.ready

  const sources = useMemo<ReportSource[]>(() => {
    if (!detailsReady) return []
    return chosen.flatMap(candidate => {
      const detail = detailResults.data[sessionIds.indexOf(candidate.sessionId)]
      const matches = candidates
        .filter(item => item.sessionId === candidate.sessionId)
        .map(item => item.match)
      return detail ? [{ detail, matches, match: candidate.match }] : []
    })
  }, [detailsReady, chosen, sessionIds, detailResults.data, candidates])

  const report = useMemo(
    () => reportDocument(sources, { recipient, route, hops, addresses, locale: getLocale() }),
    [sources, recipient, route, hops, addresses]
  )
  const text = useMemo(() => renderReportText(report), [report])

  const loading = isPending || !detailsReady
  const ready = !loading && sources.length > 0

  const ispName = reportIspName(sources)
  const publisherName = reportPublisherName(sources)
  const recipientOptions = [
    {
      value: 'isp' as const,
      label: ispName
        ? m.report_recipient_support({ name: ispName })
        : m.report_recipient_isp_unknown(),
    },
    {
      value: 'publisher' as const,
      label: publisherName
        ? m.report_recipient_support({ name: publisherName })
        : m.report_recipient_publisher_unknown(),
    },
    { value: 'forum' as const, label: m.report_recipient_forum() },
  ]

  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPicked(next)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(m.report_copied())
    } catch {
      toast.error(m.export_llm_error())
    }
  }

  const saveFile = async () => {
    try {
      const path = await save({
        defaultPath: `gameroute-report-${fileStamp()}.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      })
      if (!path) return
      await writeExportFile(path, text)
      toast.success(m.report_saved())
    } catch (err) {
      toast.error(errorMessage(err) || m.report_save_error())
    }
  }

  const savePdf = async () => {
    setCreatingPdf(true)
    try {
      const path = await save({
        defaultPath: `gameroute-report-${fileStamp()}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (!path) return
      const [{ renderReportPdf }, { reportPdfFonts }] = await Promise.all([
        import('@/lib/report-pdf'),
        import('@/lib/report-pdf-fonts'),
      ])
      const bytes = await renderReportPdf(report, reportPdfFonts(), { locale: getLocale() })
      await writeExportPdf(path, bytes)
      toast.success(m.report_saved())
    } catch (err) {
      toast.error(errorMessage(err) || m.report_save_error())
    } finally {
      setCreatingPdf(false)
    }
  }

  const empty = !isPending && !isError && candidates.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex min-h-14 flex-wrap items-center gap-3 border-b px-4 py-2.5 sm:px-6">
        <h1 className="text-title text-foreground min-w-0 flex-[1_1_320px] font-stretch-[106%]">
          {m.report_page_title()}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!ready} onClick={saveFile}>
            <RiDownloadLine data-icon="inline-start" />
            {m.report_save()}
          </Button>
          <Button size="sm" disabled={!ready} onClick={copy}>
            <RiFileCopyLine data-icon="inline-start" />
            {m.report_copy()}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!ready || creatingPdf}
            aria-busy={creatingPdf}
            onClick={savePdf}
          >
            <RiFilePdf2Line data-icon="inline-start" />
            {m.report_save_pdf()}
          </Button>
        </div>
      </header>

      {empty ? (
        <div className="px-4 pt-5 pb-6 sm:px-6">
          <EmptyState title={m.report_matches_empty_title()}>
            {m.report_matches_empty_body()}
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-6 px-4 pt-5 pb-6 sm:px-6">
          <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
            <Field label={m.report_recipient_label()} hint={m.report_recipient_hint()}>
              <Segmented
                label={m.report_recipient_label()}
                options={recipientOptions}
                value={recipient}
                onValueChange={setRecipient}
                className="max-w-full flex-wrap"
              />
            </Field>

            <Field
              label={m.report_matches_label()}
              hint={
                candidates.length > MAX_MATCHES
                  ? `${m.report_matches_hint()} ${m.report_matches_limit({ count: String(MAX_MATCHES) })}`
                  : m.report_matches_hint()
              }
            >
              {isError ? (
                <Notice
                  tone="critical"
                  title={m.report_matches_error()}
                  action={
                    <Button size="sm" onClick={retry}>
                      {m.games_error_retry()}
                    </Button>
                  }
                />
              ) : isPending ? (
                <div className="flex flex-col gap-1.5" aria-hidden="true">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              ) : (
                <ul className="bg-card flex max-h-96 flex-col overflow-y-auto rounded-sm border">
                  {visible.map(candidate => (
                    <MatchRow
                      key={candidate.key}
                      candidate={candidate}
                      checked={selected.has(candidate.key)}
                      onToggle={() => toggle(candidate.key)}
                    />
                  ))}
                </ul>
              )}
            </Field>

            <Field label={m.report_content_label()}>
              <div className="flex flex-col gap-3">
                <SwitchField
                  label={m.report_content_route()}
                  checked={route}
                  onCheckedChange={setRoute}
                />
                <SwitchField
                  label={m.report_content_hops()}
                  checked={hops}
                  onCheckedChange={setHops}
                />
                <SwitchField
                  label={m.report_content_addresses()}
                  description={m.report_content_addresses_hint()}
                  checked={addresses}
                  onCheckedChange={setAddresses}
                />
              </div>
            </Field>
          </div>

          <Panel
            label={m.report_preview_label()}
            className="min-w-0 flex-[1_1_460px]"
            aria-busy={loading}
          >
            {!loading ? (
              <pre
                data-slot="report-preview"
                tabIndex={0}
                className="text-data-sm text-foreground max-h-[70vh] overflow-auto font-mono leading-5 whitespace-pre-wrap"
              >
                {text}
              </pre>
            ) : (
              <p className="text-ui text-muted-foreground">{m.report_preview_loading()}</p>
            )}
          </Panel>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h2 className="text-label text-muted-foreground font-stretch-[92%]">{label}</h2>
      {children}
      {hint && <p className="text-data-sm text-muted-foreground">{hint}</p>}
    </section>
  )
}

function MatchRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ReportCandidate
  checked: boolean
  onToggle: () => void
}) {
  const { match, gameName } = candidate
  const label = m.report_match_label({
    game: gameName,
    day: formatDay(match.startedAt, { weekday: true }),
    number: String(match.number),
  })
  const measure = matchMeasure(match)
  const facts = [
    formatClock(match.startedAt),
    flowServerName(match),
    measure?.pingMs != null
      ? `${formatFlowPing(measure)}${(measure.lossPct ?? 0) > 0 ? ` · ${formatLoss(measure.lossPct)}` : ''}`
      : null,
  ].filter(Boolean)

  return (
    <li className="border-b last:border-b-0">
      <label
        className={cn(
          'hover:bg-accent grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 py-2'
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="accent-primary m-0 size-4"
        />
        <span className="min-w-0">
          <span className="text-ui text-foreground block truncate">{label}</span>
          <span className="text-data-sm text-muted-foreground block truncate font-mono tabular-nums">
            {facts.join(' · ')}
          </span>
        </span>
        <StatusPill status={match.status} size="sm" />
      </label>
    </li>
  )
}

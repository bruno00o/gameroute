import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RiFileCopyLine, RiLoopLeftLine, RiMore2Fill } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import type { SessionDetail, SessionMatch } from '@/types/backend'
import {
  deleteSession,
  getSessionDetail,
  getSessionMatches,
  getSeverityThresholds,
  retryTraceroutes,
} from '@/lib/tauri'
import { sessionDiagnostic } from '@/lib/diagnostic-text'
import { exportSessionDetail } from '@/lib/export-csv'
import { generateSessionExport } from '@/lib/export-llm'
import { computeDurationSecs, formatClock, formatDay, formatElapsed } from '@/lib/format'
import { flowServerLabel, traceOf } from '@/lib/matches'
import { errorMessage } from '@/lib/utils'
import { useBreadcrumbStore, type BreadcrumbSegment } from '@/stores/breadcrumb-store'
import { useSettingsStore } from '@/stores/settings-store'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/empty-state'
import { Notice } from '@/components/notice'
import { DetailSkeleton } from '@/components/session/detail-skeleton'
import { PeriodDetail } from '@/components/session/period-detail'
import { SessionHeader, SessionScreen } from '@/components/session/session-screen'

export const Route = createFileRoute('/sessions/$id')({
  component: SessionPage,
  validateSearch: (search: Record<string, unknown>) => {
    const period = Number(search.period)
    return {
      period: search.period != null && Number.isFinite(period) ? period : undefined,
    }
  },
})

function periodTitle(detail: SessionDetail, matches: SessionMatch[], periodId: number) {
  const match = matches.find(item => item.periodId === periodId)
  if (match) return m.match_title({ number: String(match.number) })
  const withVoice = matches.find(item => item.voice?.periodId === periodId)
  if (withVoice) return m.match_voice_title({ number: String(withVoice.number) })
  return detail.ipPeriods.find(period => period.id === periodId)?.ip ?? null
}

function SessionPage() {
  const { id } = Route.useParams()
  const { period: periodId } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setSegments = useBreadcrumbStore(s => s.setSegments)
  const detailed = useSettingsStore(s => s.advancedMode)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const sessionId = Number(id)
  const isValidId = Number.isInteger(sessionId) && sessionId > 0

  const detailQuery = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSessionDetail(sessionId),
    enabled: isValidId,
    staleTime: 60_000,
    refetchInterval: query => (query.state.data?.endedAt === null ? 3_000 : false),
  })
  const detail = detailQuery.data
  const ongoing = detail?.endedAt === null

  const matchesQuery = useQuery({
    queryKey: ['session', sessionId, 'matches'],
    queryFn: () => getSessionMatches(sessionId),
    enabled: isValidId && detail != null,
    staleTime: 60_000,
    refetchInterval: ongoing ? 3_000 : false,
  })
  const matches = matchesQuery.data

  const { data: thresholds } = useQuery({
    queryKey: ['severity-thresholds'],
    queryFn: getSeverityThresholds,
    staleTime: Infinity,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      navigate({ to: '/sessions' })
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) || m.session_delete_error())
    },
  })

  const retryMutation = useMutation({
    mutationFn: () => retryTraceroutes(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) || m.session_retry_error())
    },
  })

  useEffect(() => {
    if (!detail) return
    const day = formatDay(detail.startedAt)
    const selected = periodId != null && matches ? periodTitle(detail, matches, periodId) : null
    const segments: BreadcrumbSegment[] = selected
      ? [
          {
            label: day,
            onClick: () =>
              navigate({ to: '/sessions/$id', params: { id }, search: { period: undefined } }),
          },
          { label: selected },
        ]
      : [{ label: day }]
    setSegments(segments)
    return () => setSegments([])
  }, [detail, matches, periodId, id, navigate, setSegments])

  const backToSessions = () => navigate({ to: '/sessions' })

  if (!isValidId || detail === null) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:px-6">
        <EmptyState
          title={m.session_gone_title()}
          action={<Button onClick={backToSessions}>{m.session_back()}</Button>}
        >
          {m.session_gone_body()}
        </EmptyState>
      </div>
    )
  }

  if (detailQuery.isError || matchesQuery.isError) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:px-6">
        <Notice
          tone="critical"
          title={m.session_load_failed()}
          action={
            <Button
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ['session', sessionId] })}
            >
              <RiLoopLeftLine data-icon="inline-start" />
              {m.session_try_again()}
            </Button>
          }
        >
          {m.session_load_failed_body()}
        </Notice>
      </div>
    )
  }

  if (!detail || !matches) return <DetailSkeleton />

  if (periodId != null) {
    return <PeriodView detail={detail} matches={matches} periodId={periodId} sessionId={id} />
  }

  const copyText = async (text: string, success: string, failure: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(success)
    } catch {
      toast.error(failure)
    }
  }

  const actions = (
    <SessionActions
      onCopyDiagnostic={() =>
        copyText(
          sessionDiagnostic(detail, matches, thresholds),
          m.session_diagnostic_copied(),
          m.export_llm_error()
        )
      }
      onCopyForAi={() =>
        copyText(
          generateSessionExport(detail, matches),
          m.export_llm_copied(),
          m.export_llm_error()
        )
      }
      onExportCsv={() => exportSessionDetail(detail)}
      onRetry={ongoing ? undefined : () => retryMutation.mutate()}
      onDelete={() => setConfirmDelete(true)}
    />
  )

  return (
    <div className="h-full overflow-y-auto">
      <SessionScreen
        detail={detail}
        matches={matches}
        thresholds={thresholds}
        detailed={detailed}
        actions={actions}
        onSelectMatch={match =>
          navigate({ to: '/sessions/$id', params: { id }, search: { period: match.periodId } })
        }
        onRetry={() => retryMutation.mutate()}
        retrying={retryMutation.isPending}
        now={detailQuery.dataUpdatedAt}
      />
      <DeleteSessionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  )
}

function SessionActions({
  onCopyDiagnostic,
  onCopyForAi,
  onExportCsv,
  onRetry,
  onDelete,
}: {
  onCopyDiagnostic: () => void
  onCopyForAi: () => void
  onExportCsv: () => void
  onRetry?: () => void
  onDelete: () => void
}) {
  return (
    <>
      <Button size="sm" onClick={onCopyDiagnostic}>
        <RiFileCopyLine data-icon="inline-start" />
        {m.session_copy_diagnostic()}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label={m.session_more_actions()} />}
        >
          <RiMore2Fill />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-48">
          <DropdownMenuItem onClick={onCopyForAi}>{m.export_llm_button()}</DropdownMenuItem>
          <DropdownMenuItem onClick={onExportCsv}>{m.export_csv_button()}</DropdownMenuItem>
          {onRetry && (
            <DropdownMenuItem onClick={onRetry}>{m.session_retry_traceroutes()}</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            {m.session_delete()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function DeleteSessionDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.session_delete_title()}</AlertDialogTitle>
          <AlertDialogDescription>{m.session_delete_description()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.session_delete_cancel()}</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={onConfirm}>
            {m.session_delete_confirm()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function PeriodView({
  detail,
  matches,
  periodId,
  sessionId,
}: {
  detail: SessionDetail
  matches: SessionMatch[]
  periodId: number
  sessionId: string
}) {
  const navigate = useNavigate()
  const backToSession = () =>
    navigate({ to: '/sessions/$id', params: { id: sessionId }, search: { period: undefined } })

  const period = detail.ipPeriods.find(item => item.id === periodId)
  if (!period) {
    return (
      <div className="h-full overflow-y-auto p-4 sm:px-6">
        <EmptyState
          title={m.match_gone()}
          action={<Button onClick={backToSession}>{m.match_back()}</Button>}
        />
      </div>
    )
  }

  const flow =
    matches.find(match => match.periodId === periodId) ??
    matches.find(match => match.voice?.periodId === periodId)?.voice
  const title = periodTitle(detail, matches, periodId) ?? period.ip
  const span = `${formatClock(period.startedAt)} → ${formatClock(period.endedAt)}`
  const facts = [
    formatElapsed(computeDurationSecs(period.startedAt, period.endedAt)),
    flow ? flowServerLabel(flow) : `${period.protocol} ${period.port}`,
  ]

  return (
    <div className="h-full overflow-y-auto">
      <SessionHeader
        title={`${title} · ${span}`}
        facts={facts}
        actions={
          <Button size="sm" variant="ghost" onClick={backToSession}>
            {m.match_back()}
          </Button>
        }
      />
      <div className="px-4 pt-5 pb-6 sm:px-6">
        <PeriodDetail
          period={period}
          summary={detail.ipSummaries.find(summary => summary.ip === period.ip)}
          traceroute={
            (flow && traceOf(flow, detail.traceroutes)) ??
            detail.traceroutes.find(trace => trace.targetIp === period.ip)
          }
        />
      </div>
    </div>
  )
}

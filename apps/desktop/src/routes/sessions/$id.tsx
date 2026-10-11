import { useEffect, useState } from 'react'
import {
  Navigate,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
} from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RiFileCopyLine, RiMore2Fill } from '@remixicon/react'
import { toast } from 'sonner'

import * as m from '@/paraglide/messages'
import { deleteSession, retryTraceroutes } from '@/lib/tauri'
import { sessionDiagnostic } from '@/lib/diagnostic-text'
import { exportSessionDetail } from '@/lib/export-csv'
import { generateSessionExport } from '@/lib/export-llm'
import { formatDay } from '@/lib/format'
import { matchOfPeriod } from '@/lib/matches'
import { errorMessage } from '@/lib/utils'
import { useSessionData } from '@/hooks/use-session-data'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
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
import { DetailSkeleton } from '@/components/session/detail-skeleton'
import { SessionScreen } from '@/components/session/session-screen'
import { SessionGone, SessionLoadError } from '@/components/session/session-states'

export const Route = createFileRoute('/sessions/$id')({
  component: SessionRoute,
  validateSearch: (search: Record<string, unknown>): { period?: number } => {
    const period = Number(search.period)
    return search.period != null && Number.isFinite(period) ? { period } : {}
  },
})

function SessionRoute() {
  const children = useChildMatches()
  return children.length > 0 ? <Outlet /> : <SessionPage />
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
  const { valid, ongoing, detailQuery, matchesQuery, thresholds } = useSessionData(sessionId)
  const detail = detailQuery.data
  const matches = matchesQuery.data

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
    setSegments([{ label: formatDay(detail.startedAt, { weekday: true }) }])
    return () => setSegments([])
  }, [detail, setSegments])

  if (!valid || detail === null) {
    return <SessionGone onBack={() => navigate({ to: '/sessions' })} />
  }

  if (detailQuery.isError || matchesQuery.isError) {
    return (
      <SessionLoadError
        onRetry={() => queryClient.invalidateQueries({ queryKey: ['session', sessionId] })}
      />
    )
  }

  if (!detail || !matches) return <DetailSkeleton />

  if (periodId != null) {
    const match = matchOfPeriod(matches, periodId)
    return match ? (
      <Navigate to="/sessions/$id/matches/$n" params={{ id, n: String(match.number) }} replace />
    ) : (
      <Navigate to="/sessions/$id" params={{ id }} replace />
    )
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
      onPrepareReport={() => navigate({ to: '/reports', search: { session: sessionId } })}
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
          navigate({
            to: '/sessions/$id/matches/$n',
            params: { id, n: String(match.number) },
          })
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
  onPrepareReport,
  onRetry,
  onDelete,
}: {
  onCopyDiagnostic: () => void
  onCopyForAi: () => void
  onExportCsv: () => void
  onPrepareReport: () => void
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
          <DropdownMenuItem onClick={onPrepareReport}>{m.report_session_action()}</DropdownMenuItem>
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

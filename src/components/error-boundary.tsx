import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { useRouter, useRouterState, type ErrorComponentProps } from '@tanstack/react-router'
import { getVersion } from '@tauri-apps/api/app'

import * as m from '@/paraglide/messages'
import { getLocale } from '@/paraglide/runtime'
import { buildErrorReport, describeError } from '@/lib/error-report'
import { Button } from '@/components/ui/button'

type CopyState = 'idle' | 'copied' | 'failed'

type ErrorScreenProps = {
  error: unknown
  componentStack?: string | null
  path?: string
  onReload: () => void
}

function ErrorScreen({ error, componentStack, path, onReload }: ErrorScreenProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle')

  useEffect(() => {
    if (copyState === 'idle') return
    const timer = setTimeout(() => setCopyState('idle'), 2500)
    return () => clearTimeout(timer)
  }, [copyState])

  const handleCopy = async () => {
    let version: string | null = null
    try {
      version = await getVersion()
    } catch {
      version = null
    }
    const report = buildErrorReport({
      error,
      componentStack,
      path,
      version,
      locale: getLocale(),
      userAgent: navigator.userAgent,
    })
    try {
      await navigator.clipboard.writeText(report)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const copyLabel =
    copyState === 'copied'
      ? m.error_report_copied()
      : copyState === 'failed'
        ? m.error_report_copy_failed()
        : m.error_copy_report()

  return (
    <div data-slot="error-screen" className="h-full overflow-y-auto p-4">
      <div className="flex max-w-2xl flex-col items-start gap-3">
        <div role="alert" className="flex flex-col gap-1">
          <h1 className="text-title">{m.error_title()}</h1>
          <p className="text-body text-muted-foreground max-w-[65ch]">{m.error_body()}</p>
        </div>
        <pre className="bg-muted text-data-sm text-muted-foreground max-h-40 w-full overflow-auto rounded-sm px-3 py-2 font-mono whitespace-pre-wrap">
          {describeError(error)}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onReload}>
            {m.error_reload()}
          </Button>
          <Button onClick={handleCopy}>{copyLabel}</Button>
        </div>
        <span role="status" className="sr-only">
          {copyState === 'idle' ? '' : copyLabel}
        </span>
      </div>
    </div>
  )
}

function RouteErrorScreen({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const path = useRouterState({ select: state => state.location.pathname })

  return (
    <ErrorScreen
      error={error}
      path={path}
      onReload={() => {
        reset()
        void router.invalidate()
      }}
    />
  )
}

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
  error: unknown
  componentStack: string | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, componentStack: null }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  reset = () => {
    this.setState({ hasError: false, error: null, componentStack: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorScreen
          error={this.state.error}
          componentStack={this.state.componentStack}
          path={window.location.pathname}
          onReload={this.reset}
        />
      )
    }

    return this.props.children
  }
}

export { ErrorBoundary, ErrorScreen, RouteErrorScreen, type ErrorScreenProps }

import { Component, type ErrorInfo, type ReactNode } from 'react'

import * as m from '@/paraglide/messages'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md text-center">
            <h2 className="text-lg font-semibold">{m.error_boundary_title()}</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {this.state.error?.message || m.error_boundary_fallback()}
            </p>
            <button
              type="button"
              className="bg-primary text-primary-foreground mt-4 rounded-md px-4 py-2 text-sm"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              {m.error_boundary_retry()}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

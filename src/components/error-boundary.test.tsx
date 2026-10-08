import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ErrorBoundary, ErrorScreen } from './error-boundary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorScreen', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  it('says what happened and offers to reload the screen', async () => {
    const onReload = vi.fn()
    render(<ErrorScreen error={new Error('boom')} onReload={onReload} />)

    expect(screen.getByRole('alert')).toHaveTextContent('This screen could not be displayed.')
    expect(screen.getByText('Error: boom')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reload screen' }))
    expect(onReload).toHaveBeenCalledOnce()
  })

  it('copies an error report with the screen and the stack', async () => {
    const error = new Error('Cannot read properties of undefined')
    render(<ErrorScreen error={error} path="/sessions/12" onReload={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy error report' }))

    expect(writeText).toHaveBeenCalledOnce()
    const report = writeText.mock.calls[0][0] as string
    expect(report).toContain('Screen: /sessions/12')
    expect(report).toContain('Error: Cannot read properties of undefined')
    expect(await screen.findByRole('button', { name: 'Report copied' })).toBeInTheDocument()
  })

  it('says so when the clipboard refuses the report', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    render(<ErrorScreen error={new Error('boom')} onReload={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Copy error report' }))

    expect(await screen.findByRole('button', { name: 'Could not copy' })).toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  it('replaces a crashed tree with the error screen and renders it again on reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    function Flaky() {
      if (shouldThrow) throw new Error('render failed')
      return <p>Recovered</p>
    }

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>
    )

    expect(screen.getByText('Error: render failed')).toBeInTheDocument()

    shouldThrow = false
    await userEvent.click(screen.getByRole('button', { name: 'Reload screen' }))

    expect(screen.getByText('Recovered')).toBeInTheDocument()
  })
})

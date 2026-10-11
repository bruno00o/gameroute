import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { Button } from '@/components/ui/button'
import { Notice } from './notice'

afterEach(cleanup)

describe('Notice', () => {
  it('is a polite status by default', () => {
    render(<Notice title="Live measurement on">One probe per second.</Notice>)

    expect(screen.getByRole('status')).toHaveTextContent('Live measurement on')
  })

  it('is an alert when critical and keeps its action', () => {
    render(
      <Notice tone="critical" title="Capture service stopped" action={<Button>Restart</Button>}>
        Game connections are not detected.
      </Notice>
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('data-tone', 'critical')
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
  })
})

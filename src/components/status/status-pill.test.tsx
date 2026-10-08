import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { StatusPill } from './status-pill'

afterEach(cleanup)

describe('StatusPill', () => {
  it('always pairs the glyph with the word', () => {
    render(<StatusPill status="watch" />)

    const pill = screen.getByText('Watch').parentElement!
    expect(pill.querySelector('[data-slot=severity-glyph]')).toHaveAttribute('data-status', 'watch')
  })

  it('has no fill by default', () => {
    render(<StatusPill status="critical" />)

    expect(screen.getByText('Critical').parentElement!.className).not.toMatch(/bg-/)
  })

  it('fills only degraded and critical in the soft variant', () => {
    render(
      <>
        <StatusPill status="ok" variant="soft" />
        <StatusPill status="watch" variant="soft" />
        <StatusPill status="degraded" variant="soft" />
        <StatusPill status="critical" variant="soft" />
      </>
    )

    expect(screen.getByText('Good').parentElement!.className).not.toMatch(/bg-/)
    expect(screen.getByText('Watch').parentElement!.className).not.toMatch(/bg-/)
    expect(screen.getByText('Degraded').parentElement).toHaveClass('bg-degraded-soft')
    expect(screen.getByText('Critical').parentElement).toHaveClass('bg-critical-soft')
  })

  it('accepts a custom label', () => {
    render(<StatusPill status="unmeasured">No probe yet</StatusPill>)

    expect(screen.getByText('No probe yet')).toBeInTheDocument()
  })
})

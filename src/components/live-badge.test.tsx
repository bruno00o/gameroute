import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { LiveBadge } from './live-badge'

afterEach(cleanup)

const pulses = (container: HTMLElement) => container.querySelectorAll('[data-slot=live-pulse]')

describe('LiveBadge', () => {
  it('names its state unless given a label', () => {
    render(
      <>
        <LiveBadge state="live" />
        <LiveBadge state="measuring" label="Valorant detected, waiting for the match" />
      </>
    )

    expect(screen.getByText('In match')).toBeInTheDocument()
    expect(screen.getByText('Valorant detected, waiting for the match')).toBeInTheDocument()
  })

  it('fills only the live state', () => {
    render(
      <>
        <LiveBadge state="live" />
        <LiveBadge state="measuring" />
        <LiveBadge state="idle" />
        <LiveBadge state="stale" />
      </>
    )

    const badges = screen.getAllByRole('status')
    const filled = badges.filter(badge => /\bbg-/.test(badge.className))
    expect(filled.map(badge => badge.dataset.state)).toEqual(['live'])
  })

  it('keeps the orbit still until a new sample arrives', () => {
    const { container, rerender } = render(<LiveBadge state="live" sample={1} />)
    expect(pulses(container)).toHaveLength(0)

    rerender(<LiveBadge state="live" sample={1} />)
    expect(pulses(container)).toHaveLength(0)
  })

  it('pulses once per new sample', () => {
    const { container, rerender } = render(<LiveBadge state="live" sample={1} />)

    rerender(<LiveBadge state="live" sample={2} />)
    const first = pulses(container)
    expect(first).toHaveLength(1)

    rerender(<LiveBadge state="live" sample={2} />)
    expect(pulses(container)[0]).toBe(first[0])

    rerender(<LiveBadge state="live" sample={3} />)
    expect(pulses(container)).toHaveLength(1)
    expect(pulses(container)[0]).not.toBe(first[0])
  })

  it('never pulses outside the live state', () => {
    const { container, rerender } = render(<LiveBadge state="measuring" sample={1} />)

    rerender(<LiveBadge state="measuring" sample={2} />)
    rerender(<LiveBadge state="stale" sample={3} />)

    expect(pulses(container)).toHaveLength(0)
  })
})

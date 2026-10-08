import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Button } from '@/components/ui/button'
import { EmptyState } from './empty-state'
import { Fact, FactRow } from './fact-row'
import { Panel } from './panel'

afterEach(cleanup)

describe('Panel', () => {
  it('names its region with the short label and shows the factual title under it', () => {
    render(
      <Panel label="Match server" title="Valorant · Paris · 203.0.113.200">
        Body
      </Panel>
    )

    const region = screen.getByRole('region', { name: 'Match server' })
    expect(region).toHaveTextContent('Valorant · Paris · 203.0.113.200')
    expect(screen.getByRole('heading', { level: 2, name: 'Match server' })).toBeInTheDocument()
  })

  it('can sit one heading level lower', () => {
    render(
      <Panel label="Route" level={3}>
        Body
      </Panel>
    )

    expect(screen.getByRole('heading', { level: 3, name: 'Route' })).toBeInTheDocument()
  })

  it('renders its action and footer', () => {
    render(
      <Panel label="Recent activity" action={<Button>View all</Button>} footer="Since 21:04">
        Body
      </Panel>
    )

    expect(screen.getByRole('button', { name: 'View all' })).toBeInTheDocument()
    expect(screen.getByText('Since 21:04').tagName).toBe('FOOTER')
  })

  it('opens with Enter or Space when interactive', async () => {
    const onClick = vi.fn()
    render(
      <Panel label="Previous session" interactive onClick={onClick}>
        Body
      </Panel>
    )

    const panel = screen.getByRole('region', { name: 'Previous session' })
    expect(panel).toHaveAttribute('tabindex', '0')

    panel.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')

    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('is not focusable by default', () => {
    render(<Panel label="Route">Body</Panel>)

    expect(screen.getByRole('region', { name: 'Route' })).not.toHaveAttribute('tabindex')
  })
})

describe('EmptyState', () => {
  it('states one fact, one sentence and one action, left-aligned', () => {
    render(
      <EmptyState title="No sessions recorded." action={<Button>Add a game</Button>}>
        A session starts when a monitored game connects to its server.
      </EmptyState>
    )

    const root = screen.getByText('No sessions recorded.').parentElement!
    expect(root).toHaveClass('items-start', 'text-left')
    expect(root.querySelector('svg')).toBeNull()
    expect(screen.getByText(/A session starts/)).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})

describe('FactRow', () => {
  it('pairs each label with its value', () => {
    render(
      <FactRow>
        <Fact label="Median ping">24 ms</Fact>
        <Fact label="Loss" detail="over 3 matches">
          0.4%
        </Fact>
      </FactRow>
    )

    const terms = screen.getAllByRole('term').map(term => term.textContent)
    const values = screen.getAllByRole('definition').map(value => value.textContent)
    expect(terms).toEqual(['Median ping', 'Loss'])
    expect(values).toEqual(['24 ms', '0.4%', 'over 3 matches'])
  })

  it('shows a dash for a missing value but keeps zero', () => {
    render(
      <FactRow>
        <Fact label="Jitter">{null}</Fact>
        <Fact label="Problem hops">{0}</Fact>
      </FactRow>
    )

    const values = screen.getAllByRole('definition').map(value => value.textContent)
    expect(values).toEqual(['—', '0'])
  })

  it('explains a label in a tooltip trigger reachable by keyboard', async () => {
    render(
      <FactRow>
        <Fact label="Avg ping" hint="Average response time to game servers.">
          24 ms
        </Fact>
      </FactRow>
    )

    await userEvent.tab()

    expect(screen.getByRole('button', { name: 'Avg ping' })).toHaveFocus()
  })
})

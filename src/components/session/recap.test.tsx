import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { matchRecap, recapCells, sessionDetail, sessionMatches } from '@/test/session-fixtures'
import { MatchScreen } from './match-screen'
import { MatchTimeline } from './match-timeline'
import { RecapScreen } from './recap-screen'

vi.mock('@/lib/tauri', () => ({ resolveAsn: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/components/route/route-map', () => ({ RouteMap: () => null }))

afterEach(cleanup)

const matches = sessionMatches()
const match = matches[1]

function renderRecap(props: Partial<React.ComponentProps<typeof RecapScreen>> = {}) {
  return render(
    <RecapScreen
      detail={sessionDetail()}
      matches={matches}
      match={match}
      recap={matchRecap()}
      {...props}
    />
  )
}

describe('MatchTimeline', () => {
  it('draws one cell per slice and colours only the flagged ones', () => {
    const { container } = render(
      <MatchTimeline cells={recapCells(10, [4])} bucketSecs={30} durationSecs={300} />
    )

    const cells = [...container.querySelectorAll('ol > li')]
    expect(cells).toHaveLength(10)
    expect(cells.map(cell => cell.getAttribute('data-status'))).toEqual([
      'unmeasured',
      'ok',
      'ok',
      'ok',
      'degraded',
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
    ])
    expect(cells[4]).toHaveAttribute('title', '2:00–2:30 · Degraded · 14 ms')
    expect(cells[1].className).toContain('bg-measured')
    expect(cells[4].className).toContain('bg-degraded')
  })

  it('leaves the latency line broken where nothing was measured', () => {
    const cells = recapCells(6)
    cells[3] = { ...cells[3], pingMs: null, status: 'unmeasured' }
    const { container } = render(<MatchTimeline cells={cells} bucketSecs={30} durationSecs={180} />)

    expect(container.querySelectorAll('svg path')).toHaveLength(2)
    expect(screen.getByText('max 15 ms')).toBeInTheDocument()
  })

  it('only legends the statuses it shows', () => {
    render(<MatchTimeline cells={recapCells(4)} bucketSecs={30} durationSecs={120} />)

    const legend = screen.getByRole('figure').querySelector('figcaption')!
    expect(legend).toHaveTextContent('Under the thresholds')
    expect(legend).toHaveTextContent('No measurement')
    expect(legend).not.toHaveTextContent('Degraded')
  })
})

describe('RecapScreen', () => {
  it('opens on a factual title with the figures and their source', () => {
    renderRecap()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Match 2 ended · 31:12')
    const verdict = document.querySelector('[data-slot=verdict]')!
    expect(verdict).toHaveAttribute('data-status', 'degraded')
    expect(within(verdict as HTMLElement).getByRole('heading')).toHaveTextContent(
      '13 ms measured by the game, 0.4% loss, 1 incident of 40 s at your ISP at 12:31'
    )
  })

  it('lists the incident with its range and the provenance of its figures', () => {
    renderRecap()

    const incidents = screen.getByRole('list', { name: 'Incidents' })
    expect(incidents).toHaveTextContent('12:31 → 13:11 · 40 s')
    expect(incidents).toHaveTextContent('at your ISP')
    expect(incidents).toHaveTextContent('ping ≥ 31 ms')
    expect(incidents).toHaveTextContent('measured up to hop 5')
  })

  it('labels the game ping and keeps the probes as their own rows', () => {
    renderRecap()

    const rows = document.querySelectorAll('[data-point]')
    expect([...rows].map(row => row.getAttribute('data-point'))).toEqual(['floor', 'game'])
    expect(rows[0]).toHaveTextContent('Up to hop 5')
    expect(rows[0]).toHaveTextContent('≥ 4.7 ms')
    expect(rows[1]).toHaveTextContent('Measured by the game')
    expect(rows[1]).toHaveTextContent('7,600 packets')
  })

  it('says there is no incident instead of colouring a healthy match', () => {
    renderRecap({
      recap: matchRecap({ incidents: [], cells: recapCells(63) }),
    })

    expect(document.querySelector('[data-slot=verdict]')).toHaveAttribute('data-status', 'ok')
    expect(screen.getByText(/No incident: everything measured/)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-status=degraded]')).toHaveLength(0)
  })

  it('shows an honest empty state for a match recorded before live measurement', () => {
    renderRecap({ recap: null })

    expect(screen.getByText('No detailed measurement for this match')).toBeInTheDocument()
    expect(document.querySelector('[data-slot=match-timeline]')).toBeNull()
  })

  it('offers the match detail and the report', async () => {
    const onOpenMatch = vi.fn()
    const onPrepareReport = vi.fn()
    renderRecap({ onOpenMatch, onPrepareReport })

    await userEvent.click(screen.getByRole('button', { name: /View the match in detail/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Prepare a report' }))

    expect(onOpenMatch).toHaveBeenCalledTimes(1)
    expect(onPrepareReport).toHaveBeenCalledTimes(1)
  })

  it('does not call a match over while the session is still on its last match', () => {
    renderRecap({ match: matches[2], detail: sessionDetail({ endedAt: null }) })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Match 3 · 42:36')
  })
})

describe('MatchScreen with a recap', () => {
  it('adds the timeline and the incidents under the figures of the match', () => {
    render(
      <MatchScreen
        detail={sessionDetail()}
        matches={matches}
        match={match}
        recap={matchRecap()}
        onOpenRecap={() => {}}
      />
    )

    const timeline = screen.getByRole('region', { name: 'The match, in 30 s slices' })
    expect(timeline.querySelectorAll('[data-slot=match-timeline] li')).toHaveLength(63)
    expect(timeline).toHaveTextContent('1 incident')
    expect(screen.getByRole('button', { name: 'View the summary' })).toBeInTheDocument()
  })

  it('shows nothing of it for an older match without probes', () => {
    render(
      <MatchScreen
        detail={sessionDetail()}
        matches={matches}
        match={match}
        recap={matchRecap({ points: [], primary: null, incidents: [] })}
        onOpenRecap={() => {}}
      />
    )

    expect(document.querySelector('[data-slot=match-timeline]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'View the summary' })).toBeNull()
  })
})

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  at,
  measure,
  riotRoute,
  sessionDetail,
  sessionMatches,
  trace,
  RIOT,
} from '@/test/session-fixtures'
import { MatchTable } from './match-table'
import { SessionScreen } from './session-screen'

afterEach(cleanup)

function bodyRows() {
  return screen.getAllByRole('row').slice(1)
}

function cellsOf(row: HTMLElement) {
  return within(row).getAllByRole('cell')
}

function renderTable(props: Partial<Parameters<typeof MatchTable>[0]> = {}) {
  const detail = sessionDetail()
  return render(
    <MatchTable
      matches={sessionMatches()}
      traceroutes={detail.traceroutes}
      sessionEndedAt={detail.endedAt}
      {...props}
    />
  )
}

describe('MatchTable', () => {
  it('lists every match in order with its server, figures and quality', () => {
    renderTable()

    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      '#',
      'Start',
      'Duration',
      'Server',
      'Ping',
      'Loss',
      'Voice',
      'Quality',
    ])
    const rows = bodyRows()
    expect(rows.map(row => cellsOf(row)[0].textContent)).toEqual(['1', '2', '3'])

    const first = cellsOf(rows[0])
    expect(first[1]).toHaveTextContent('15:45')
    expect(first[2]).toHaveTextContent('6:36')
    expect(first[3]).toHaveTextContent('Riot Games, UDP 7284')
    expect(first[5]).toHaveTextContent('0%')
    expect(first[7]).toHaveTextContent('Good')
    expect(first[7].querySelector('[data-slot=status-pill]')).toHaveAttribute('data-status', 'ok')
  })

  it('never shows a city for a Riot server', () => {
    renderTable()

    expect(screen.queryByText(/Los Angeles/)).toBeNull()
  })

  it('prefixes a silent destination with ≥ and says how far it was measured', () => {
    renderTable()

    const ping = cellsOf(bodyRows()[0])[4]
    expect(ping).toHaveTextContent('≥ 18 ms')
    expect(ping).toHaveTextContent('measured up to hop 3 (RETN)')
    expect(ping).not.toHaveTextContent('trace at')
  })

  it('says which match a borrowed trace comes from', () => {
    renderTable()

    expect(cellsOf(bodyRows()[1])[4]).toHaveTextContent('trace from match 1')
  })

  it('gives the offset of the trace and the jitter in the detailed view', () => {
    renderTable({ detailed: true })

    const first = cellsOf(bodyRows()[0])
    expect(first[3]).toHaveTextContent(RIOT)
    expect(first[4]).toHaveTextContent('trace at 0:41')
    expect(first[6]).toHaveTextContent('1.0 ms')
    expect(first[6].className).not.toMatch(/text-(ok|watch|degraded|critical)/)
  })

  it('shows an unmeasured match as such, never as zero', () => {
    renderTable()

    const third = cellsOf(bodyRows()[2])
    expect(third[4]).toHaveTextContent('—')
    expect(third[5]).toHaveTextContent('—')
    expect(third[7]).toHaveTextContent('Not measurable')
    expect(third[7].querySelector('[data-slot=status-pill]')).toHaveAttribute(
      'data-status',
      'unmeasured'
    )
  })

  it('puts the linked voice ping next to its match', () => {
    renderTable()

    const rows = bodyRows()
    expect(cellsOf(rows[0])[6]).toHaveTextContent('14 ms')
    expect(cellsOf(rows[1])[6]).toHaveTextContent('—')
  })

  it('says when a linked voice flow has no trace', () => {
    const matches = sessionMatches()
    matches[1].voice = { ...matches[0].voice!, periodId: 202, trace: null, status: 'unmeasured' }
    renderTable({ matches })

    expect(cellsOf(bodyRows()[1])[6]).toHaveTextContent('no trace')
  })
})

describe('SessionScreen', () => {
  it('opens on the facts of the session', () => {
    render(<SessionScreen detail={sessionDetail()} matches={sessionMatches()} />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('VALORANT, 15:40 → 20:14')
    expect(screen.getByText(/3 matches, 2 game servers, 2 voice servers/)).toBeInTheDocument()
  })

  it('titles the verdict with its figure and locates the silent server', () => {
    render(<SessionScreen detail={sessionDetail()} matches={sessionMatches()} />)

    const verdict = screen.getByRole('region', { name: /^≥\s18\sms to the server, no loss$/ })
    expect(verdict).toHaveTextContent('2/3 matches measured, one trace per server')
    expect(verdict).toHaveTextContent(
      "The server doesn't answer pings, which is normal: measured up to hop 3 (RETN)."
    )
    expect(verdict).toHaveTextContent('1 match could not be measured.')

    const zones = within(within(verdict).getByRole('list')).getAllByRole('listitem')
    expect(zones.map(zone => zone.dataset.status ?? null)).toEqual(['ok', 'ok', 'ok', 'unmeasured'])
    expect(zones[2]).toHaveTextContent('Transit (RETN)')
    expect(zones[3]).toHaveTextContent("Game server (Riot Games)Doesn't answer pings")
  })

  it('names the operator where a persistent loss starts', () => {
    const matches = sessionMatches().map(match =>
      match.trace
        ? { ...match, status: 'critical' as const, trace: measure({ lossPct: 33.3 }) }
        : match
    )
    const detail = sessionDetail({
      traceroutes: [trace(11, RIOT, at(15, 45, 41), riotRoute('critical'))],
    })
    render(<SessionScreen detail={detail} matches={matches} />)

    const verdict = screen.getByRole('region', { name: '33% loss at RETN during matches 1 and 2' })
    expect(verdict).toHaveAttribute('data-status', 'critical')
    expect(verdict).toHaveTextContent('The loss starts on the transit and carries on to hop 3.')
    const transit = within(verdict)
      .getAllByRole('listitem')
      .find(zone => zone.dataset.zone === 'transit')!
    expect(transit).toHaveAttribute('aria-current', 'true')
    expect(transit).toHaveTextContent('33% loss')
    expect(transit).toHaveTextContent('Here')
  })

  it('draws matches and every voice flow on the timeline, linked or not', () => {
    render(<SessionScreen detail={sessionDetail()} matches={sessionMatches()} />)

    const games = screen.getByRole('list', { name: 'Matches, Riot Games' })
    expect(
      within(games)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual([
      '1Match 1, 15:45–15:51, Good',
      '2Match 2, 15:54–16:25, Good',
      '3Match 3, 16:27–17:09, Not measurable',
    ])
    const voice = screen.getByRole('list', { name: 'Voice' })
    expect(
      within(voice)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Voice, 15:45–15:52', 'Voice, 16:30–16:40'])
  })

  it('says a match could not be measured when no trace answered', () => {
    const [, , unmeasured] = sessionMatches()
    render(
      <SessionScreen
        detail={sessionDetail()}
        matches={[{ ...unmeasured, number: 1 }]}
        onRetry={() => {}}
      />
    )

    const verdict = screen.getByRole('region', { name: 'Match 1 could not be measured' })
    expect(verdict).toHaveAttribute('data-status', 'unmeasured')
    expect(within(verdict).queryByRole('list')).toBeNull()
    expect(within(verdict).getByRole('button', { name: 'Retry traceroutes' })).toBeInTheDocument()
  })

  it('waits for the trace of a match while the session is running', () => {
    const [, , unmeasured] = sessionMatches()
    render(
      <SessionScreen
        detail={sessionDetail({ endedAt: null })}
        matches={[{ ...unmeasured, number: 1 }]}
        onRetry={() => {}}
      />
    )

    const verdict = screen.getByRole('region', { name: 'Match 1 is not measured yet' })
    expect(within(verdict).queryByRole('button')).toBeNull()
  })

  it('shows an empty state and no verdict for a session without matches', () => {
    render(
      <SessionScreen detail={sessionDetail({ ipPeriods: [], traceroutes: [] })} matches={[]} />
    )

    expect(screen.getByText('No match in this session')).toBeInTheDocument()
    expect(document.querySelector('[data-slot=verdict]')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/0 matches/)).toBeInTheDocument()
  })

  it('waits for the first match while the session is still running', () => {
    render(
      <SessionScreen
        detail={sessionDetail({ endedAt: null, ipPeriods: [], traceroutes: [] })}
        matches={[]}
      />
    )

    expect(screen.getByText('No match yet')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('VALORANT, 15:40 → now')
  })
})

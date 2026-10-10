import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SessionMatch } from '@/types/backend'
import { measure, sessionDetail, sessionMatches, thresholds } from '@/test/session-fixtures'
import { MatchScreen, type MatchScreenProps } from './match-screen'

vi.mock('@/lib/tauri', () => ({ resolveAsn: vi.fn(() => new Promise(() => {})) }))
vi.mock('@/components/route/route-map', () => ({ RouteMap: () => null }))

afterEach(cleanup)

function renderMatch(number: number, props: Partial<MatchScreenProps> = {}) {
  const matches = props.matches ?? sessionMatches()
  return render(
    <MatchScreen
      detail={sessionDetail()}
      matches={matches}
      match={matches[number - 1]}
      thresholds={thresholds()}
      {...props}
    />
  )
}

const region = (name: string) => screen.getByRole('region', { name })

function fact(scope: HTMLElement, label: string) {
  return within(scope).getByText(label).closest('[data-slot=fact]') as HTMLElement
}

function headerStatus() {
  return document.querySelector('[data-slot=match-screen] > header [data-slot=status-pill]')
}

describe('MatchScreen', () => {
  it('opens on the match, its server and its network status', () => {
    renderMatch(1)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Match 1, 15:45 → 15:51')
    expect(screen.getByText('6:36, Riot Games, UDP 7284')).toBeInTheDocument()
    expect(headerStatus()).toHaveAttribute('data-status', 'ok')
    expect(screen.queryByText(/Los Angeles/)).toBeNull()
  })

  it('gives the figures of the trace with their source', () => {
    renderMatch(1)

    const measures = region('This match')
    expect(measures).toHaveTextContent('From the trace at 0:41')
    expect(fact(measures, 'Loss')).toHaveTextContent('0%')
    expect(within(measures).queryByText('Jitter')).toBeNull()
    expect(measures).toHaveTextContent('Ping and loss come from one trace per server.')
  })

  it('prefixes a silent server with ≥ and says how far it was measured', () => {
    renderMatch(1)

    const ping = fact(region('This match'), 'Ping')
    expect(ping).toHaveTextContent('≥ 18 ms')
    expect(ping).toHaveTextContent('measured up to hop 3 (RETN)')
    expect(region('Route')).toHaveTextContent("Riot GamesDoesn't answer pings")
  })

  it('shows the ping measured by the game and keeps the route of the trace', () => {
    const matches = sessionMatches()
    matches[0] = {
      ...matches[0],
      game: {
        measuredAt: matches[0].startedAt,
        sampleCount: 38,
        pingMs: 13.2,
        jitterMs: 2.3,
        lossPct: 0,
        packetsLost: 0,
        usual: null,
      },
    }
    renderMatch(1, { matches })

    const measures = region('This match')
    const ping = fact(measures, 'Ping')
    expect(ping).toHaveTextContent('13 ms')
    expect(ping).not.toHaveTextContent('≥')
    expect(ping).toHaveTextContent('measured by the game')
    expect(measures).not.toHaveTextContent('From the trace')
    expect(measures).toHaveTextContent('The ping comes from the game itself')
    expect(region('Route')).toHaveTextContent("Riot GamesDoesn't answer pings")
  })

  it('shows the region pings of the game as context only', () => {
    const matches = sessionMatches()
    matches[0] = {
      ...matches[0],
      regionPings: {
        measuredAt: matches[0].startedAt,
        pings: [
          { region: 'Paris', pingMs: 4 },
          { region: 'Frankfurt', pingMs: 13 },
        ],
      },
    }
    renderMatch(1, { matches })

    const measures = region('This match')
    expect(fact(measures, 'Ping')).toHaveTextContent('≥ 18 ms')
    expect(measures).toHaveTextContent(
      'Ping measured by VALORANT before the match: Paris 4 ms, Frankfurt 13 ms'
    )
    expect(headerStatus()).toHaveAttribute('data-status', 'ok')
  })

  it('adds jitter and the worst value in the detailed view, without colour', () => {
    renderMatch(1, { detailed: true })

    const measures = region('This match')
    const jitter = fact(measures, 'Jitter')
    expect(jitter).toHaveTextContent('1.0 ms')
    expect(jitter.innerHTML).not.toMatch(/text-(ok|watch|degraded|critical)/)
    expect(fact(measures, 'Worst value')).toHaveTextContent('≥ 19 ms')
  })

  it('dates a trace borrowed from another match', () => {
    renderMatch(2)

    expect(region('This match')).toHaveTextContent('From the trace of match 1')
    expect(region('Route')).toHaveTextContent('From the trace of match 1, 4 hops')
  })

  it('shows an unmeasured match as such, never as zero', () => {
    renderMatch(3)

    expect(headerStatus()).toHaveAttribute('data-status', 'unmeasured')
    expect(region('This match')).toHaveTextContent('Match 3 could not be measured')
    expect(region('Route')).toHaveTextContent('No trace to this server.')
    expect(region('Why this status')).toHaveTextContent('No figure to compare')
    expect(screen.queryByText(/(^|\s)0\sms/)).toBeNull()
  })

  it('waits for the trace of a match while the session is running', () => {
    const matches = sessionMatches()
    render(
      <MatchScreen
        detail={sessionDetail({ endedAt: null })}
        matches={matches}
        match={matches[2]}
        thresholds={thresholds()}
      />
    )

    expect(region('This match')).toHaveTextContent('Match 3 is not measured yet')
  })

  it('explains the status with the thresholds read from the backend', () => {
    renderMatch(1)

    const why = region('Why this status')
    expect(why).toHaveTextContent('Ping ≥ 18 ms and loss 0%, under the thresholds')
    const rules = within(why).getAllByRole('definition')
    expect(rules.map(rule => rule.textContent?.replace(/\s+/g, ' '))).toEqual([
      'loss ≥ 0.5%, ping ≥ 60 ms',
      'loss ≥ 2%, ping ≥ 100 ms',
      'loss ≥ 5%, ping ≥ 150 ms',
    ])
    expect(why.querySelector('[data-current]')).toBeNull()
  })

  it('names the threshold a lossy match went past', () => {
    const matches: SessionMatch[] = sessionMatches().map(match =>
      match.number === 1 ? { ...match, status: 'degraded', trace: measure({ lossPct: 3 }) } : match
    )
    renderMatch(1, { matches })

    const why = region('Why this status')
    expect(why).toHaveTextContent('Loss 3%, 2% threshold reached')
    expect(why.querySelector('[data-current]')).toHaveTextContent('Degraded')
  })

  it('compares the ping with the usual value when there is one', () => {
    const usual = { medianMs: 4.3, sampleCount: 20 }
    const matches: SessionMatch[] = sessionMatches().map(match =>
      match.number === 1
        ? { ...match, status: 'watch', trace: measure({ pingMs: 44, usual }) }
        : match
    )
    renderMatch(1, { matches })

    const why = region('Why this status')
    expect(why).toHaveTextContent('Ping ≥ 44 ms against ≥ 4.3 ms usually, +20 ms threshold reached')
    expect(why).toHaveTextContent('median of the 20 previous measurements')
    const rules = within(why).getAllByRole('definition')
    expect(rules[0].textContent?.replace(/\s+/g, ' ')).toBe('loss ≥ 0.5%, ping ≥ usual +20 ms')
    expect(why.querySelector('[data-current]')).toHaveTextContent('Watch')
  })

  it('shows the voice flow linked to the match', () => {
    renderMatch(1)

    const voice = region('Voice')
    expect(voice).toHaveTextContent('Microsoft, Paris, UDP 27020')
    expect(fact(voice, 'Ping')).toHaveTextContent('14 ms')
    expect(fact(voice, 'Ping')).not.toHaveTextContent('≥')
    expect(voice).toHaveTextContent('From the trace at 15:47')
    expect(voice.querySelector('[data-slot=status-pill]')).toHaveAttribute('data-status', 'ok')
  })

  it('leaves out the voice panel when no voice flow is linked', () => {
    renderMatch(2)

    expect(screen.queryByRole('region', { name: 'Voice' })).toBeNull()
  })

  it('counts the packets seen by the capture', () => {
    renderMatch(1)

    const server = region('Match server')
    expect(fact(server, 'Packets')).toHaveTextContent('12,000')
    expect(fact(server, 'Average rate')).toHaveTextContent('30 packets/s')
    expect(server).toHaveTextContent('Counted by the capture, without probing the server.')
  })

  it('moves to the previous and next match with the buttons and the arrow keys', async () => {
    const user = userEvent.setup()
    const onSelectMatch = vi.fn()
    renderMatch(2, { onSelectMatch })

    await user.click(screen.getByRole('button', { name: 'Next match' }))
    expect(onSelectMatch).toHaveBeenLastCalledWith(expect.objectContaining({ number: 3 }))

    await user.keyboard('{ArrowLeft}')
    expect(onSelectMatch).toHaveBeenLastCalledWith(expect.objectContaining({ number: 1 }))

    await user.keyboard('{ArrowRight}')
    expect(onSelectMatch).toHaveBeenLastCalledWith(expect.objectContaining({ number: 3 }))
    expect(onSelectMatch).toHaveBeenCalledTimes(3)
  })

  it('stays put at the first match', async () => {
    const user = userEvent.setup()
    const onSelectMatch = vi.fn()
    renderMatch(1, { onSelectMatch })

    const previous = screen.getByRole('button', { name: 'Previous match' })
    expect(previous).toHaveAttribute('aria-disabled', 'true')
    await user.click(previous)
    await user.keyboard('{ArrowLeft}')
    expect(onSelectMatch).not.toHaveBeenCalled()
  })
})

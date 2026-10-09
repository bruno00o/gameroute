import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { LiveFault, LiveReading, LiveStatus } from '@/types/backend'
import { MiniWindow, type MiniWindowProps } from '@/components/mini/mini-window'

const NOW = Date.parse('2026-10-09T21:42:00Z')

function reading(patch: Partial<LiveReading> = {}): LiveReading {
  return {
    point: 'floor',
    basis: {
      source: 'floor',
      atDestination: false,
      measuredHop: 8,
      measuredAsn: null,
      serverIp: null,
    },
    atLeast: true,
    zone: 'transit',
    hop: 8,
    hopIp: null,
    asn: null,
    operator: null,
    medianMs: 17.6,
    usual: { medianMs: 17, sampleCount: 40 },
    traceMs: null,
    jitterMs: 1.2,
    lossPct: 0,
    lossFloorPct: null,
    lost: 0,
    sent: 60,
    sampleCount: 60,
    status: 'ok',
    cause: null,
    lastSampleAt: '2026-10-09T21:41:59Z',
    fresh: true,
    ...patch,
  }
}

function status(patch: Partial<LiveStatus> = {}): LiveStatus {
  return {
    sessionId: 7,
    gameName: 'VALORANT',
    state: 'live',
    stateSince: '2026-10-09T21:23:30Z',
    frozenReason: null,
    serverIp: '203.0.113.9',
    serverPort: 7000,
    matchStartedAt: '2026-10-09T21:23:18Z',
    lastSampleAt: '2026-10-09T21:41:59Z',
    status: 'ok',
    statusSince: null,
    cause: null,
    primary: reading(),
    points: [],
    zones: [],
    fault: null,
    region: null,
    updatedAt: '2026-10-09T21:41:59Z',
    ...patch,
  }
}

function renderMini(props: Partial<MiniWindowProps> = {}) {
  const handlers = { onCollapsedChange: vi.fn(), onClose: vi.fn() }
  render(
    <MiniWindow status={null} samples={[]} now={NOW} collapsed={false} {...handlers} {...props} />
  )
  return handlers
}

const value = () => document.querySelector('[data-slot=mini-value]')

afterEach(cleanup)

describe('Mini window', () => {
  it('says no match is running when there is no live status', () => {
    renderMini()

    expect(screen.getByText('GameRoute')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No match in progress')
    expect(value()).toHaveTextContent('—')
    expect(document.querySelector('[data-slot=mini-sparkline]')).toBeNull()
  })

  it('waits for the match without inventing a number', () => {
    renderMini({ status: status({ state: 'waiting', primary: null }) })

    expect(screen.getByText('VALORANT')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for the match')
    expect(value()).toHaveTextContent('—')
  })

  it('shows a lower bound with its sign and the hop it was measured to', () => {
    renderMini({
      status: status({
        region: { region: 'Paris', provider: null, host: null, medianMs: 19, sent: 3, received: 3 },
      }),
      samples: [{ at: NOW - 1000, rttMs: 18 }],
    })

    expect(screen.getByText('VALORANT · Paris')).toBeInTheDocument()
    expect(value()?.textContent).toBe('≥\u00a018')
    expect(screen.getByRole('status')).toHaveTextContent('In match · 18:42')
    expect(document.querySelector('[data-slot=status-pill]')).toHaveTextContent('Good')
    expect(document.querySelector('[data-slot=mini-facts]')?.textContent).toBe(
      'jitter 1.2\u00a0ms · loss 0.0% · measured up to hop 8'
    )
    expect(document.querySelector('[data-slot=mini-last]')).toHaveClass('fill-signal')
  })

  it('says when the ping comes from the game itself', () => {
    const lol = reading({
      point: 'game',
      basis: {
        source: 'game',
        atDestination: true,
        measuredHop: null,
        measuredAsn: null,
        serverIp: null,
      },
      atLeast: false,
      hop: null,
      medianMs: 38.2,
    })
    renderMini({ status: status({ gameName: 'League of Legends', primary: lol }) })

    expect(value()).toHaveTextContent(/^38$/)
    expect(document.querySelector('[data-slot=mini-facts]')).toHaveTextContent(
      'measured by the game'
    )
  })

  it('names where a fault is instead of the plain figures', () => {
    const transit = reading({ point: 'floor', lossPct: 4, status: 'degraded' })
    const fault: LiveFault = {
      zone: 'transit',
      zones: ['transit'],
      cause: 'loss',
      afterPoint: 'isp_edge',
      afterHop: 4,
      atPoint: 'floor',
      atHop: 8,
      asn: 9002,
      operator: 'RETN',
    }
    renderMini({
      status: status({ status: 'degraded', primary: transit, points: [transit], fault }),
    })

    expect(document.querySelector('[data-slot=mini-fault]')).toHaveTextContent(
      'Loss of 4% at RETN, not at home'
    )
    expect(document.querySelector('[data-slot=mini-facts]')).toBeNull()
    expect(document.querySelector('[data-slot=status-pill]')).toHaveTextContent('Degraded')
  })

  it('marks a frozen signal as stale, without cyan or a curve', () => {
    renderMini({
      status: status({
        state: 'frozen',
        frozenReason: 'capture_service',
        lastSampleAt: '2026-10-09T21:41:54Z',
      }),
      samples: [{ at: NOW - 6000, rttMs: 18 }],
    })

    expect(screen.getByRole('status')).toHaveTextContent('Signal frozen · 6 s ago')
    expect(value()?.className).toContain('decoration-dashed')
    expect(screen.getByText(/The capture service is not responding/)).toBeInTheDocument()
    expect(document.querySelector('[data-slot=mini-sparkline]')).toBeNull()
    expect(document.querySelector('[data-slot=status-pill]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Collapse to a bar' })).toBeNull()
  })

  it('pulses once per new sample, only while live', () => {
    const live = status()
    const first = { source: 'floor', measuredAt: '2026-10-09T21:41:58Z', rttMs: 18 }
    const second = { ...first, measuredAt: '2026-10-09T21:41:59Z' }
    const { rerender } = render(
      <MiniWindow
        status={live}
        samples={[]}
        sample={first}
        now={NOW}
        collapsed={false}
        onCollapsedChange={() => {}}
        onClose={() => {}}
      />
    )
    const pulse = () => document.querySelector('[data-slot=live-pulse]')
    const firstPulse = pulse()

    rerender(
      <MiniWindow
        status={live}
        samples={[]}
        sample={first}
        now={NOW + 1000}
        collapsed={false}
        onCollapsedChange={() => {}}
        onClose={() => {}}
      />
    )
    expect(pulse()).toBe(firstPulse)

    rerender(
      <MiniWindow
        status={live}
        samples={[]}
        sample={second}
        now={NOW + 1000}
        collapsed={false}
        onCollapsedChange={() => {}}
        onClose={() => {}}
      />
    )
    expect(pulse()).not.toBe(firstPulse)
  })

  it('collapses to a bar with the figure and the status', async () => {
    const { onCollapsedChange } = renderMini({ status: status(), collapsed: true })

    expect(screen.getByRole('status').textContent).toBe('≥\u00a018\u00a0ms')
    expect(document.querySelector('[data-slot=status-pill]')).toHaveTextContent('Good')

    await userEvent.click(screen.getByRole('button', { name: 'Expand the mini window' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(false)
  })

  it('closes and collapses on request', async () => {
    const { onClose, onCollapsedChange } = renderMini({ status: status() })

    await userEvent.click(screen.getByRole('button', { name: 'Collapse to a bar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close the mini window' }))

    expect(onCollapsedChange).toHaveBeenCalledWith(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

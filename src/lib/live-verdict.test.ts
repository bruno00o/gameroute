import { describe, expect, it } from 'vitest'

import { liveVerdict, liveZones, metricText } from './live-verdict'
import { matchIncidents, timelineCells, timelineEvents } from './live-timeline'
import {
  atMatch,
  gameReading,
  homeFault,
  incident,
  liveStatus,
  transitFault,
} from '@/test/live-fixtures'

const plain = (text: string | undefined) => text?.replace(/\u00a0/g, ' ')

describe('liveVerdict', () => {
  it('states the figures when nothing is wrong, with the lower bound kept', () => {
    const verdict = liveVerdict(liveStatus())

    expect(verdict?.status).toBe('ok')
    expect(plain(verdict?.title)).toBe('≥ 18 ms against ≥ 17 ms usually, 0% loss')
    expect(verdict?.body).toContain('measured up to hop 8 (RETN)')
    expect(verdict?.advice).toEqual([])
    expect(verdict?.zone).toBeNull()
  })

  it('presents the game ping without a bound', () => {
    const verdict = liveVerdict(liveStatus({ primary: gameReading() }))

    expect(plain(verdict?.title)).toBe('31 ms against 30 ms usually, 0% loss')
    expect(verdict?.body).toContain('the game measures itself')
  })

  it('says where the loss starts, since when, and that it is not at home', () => {
    const verdict = liveVerdict(liveStatus(transitFault()))

    expect(verdict?.status).toBe('degraded')
    expect(plain(verdict?.title)).toBe('4% loss at RETN since 5:00, not at your end')
    expect(verdict?.zone).toBe('transit')
    expect(verdict?.advice).toHaveLength(1)
    expect(verdict?.zones.transit).toMatchObject({ status: 'degraded', note: '4% loss' })
    expect(verdict?.zones.home).toMatchObject({ status: 'ok', note: 'Good' })
    expect(verdict?.zones.service).toMatchObject({
      status: 'unmeasured',
      note: "Doesn't answer pings",
    })
  })

  it('masks the rest of the route while the box loses packets', () => {
    const status = liveStatus(homeFault())
    const verdict = liveVerdict(status)

    expect(plain(verdict?.title)).toBe('3% loss at home since 3:10')
    expect(verdict?.zone).toBe('home')
    expect(verdict?.body).toContain('nothing can be said about the rest of the route')
    for (const zone of ['isp', 'transit', 'service'] as const) {
      expect(verdict?.zones[zone]).toMatchObject({
        status: 'unmeasured',
        note: 'Hidden by the router',
      })
    }
  })

  it('does not rate a match that is not live', () => {
    expect(liveVerdict(liveStatus({ state: 'frozen' }))).toBeNull()
    expect(liveVerdict(liveStatus({ state: 'measuring', primary: null }))).toBeNull()
  })

  it('names every zone even when the backend returned fewer', () => {
    const zones = liveZones(liveStatus({ zones: [] }))

    expect(Object.keys(zones)).toEqual(['home', 'isp', 'transit', 'service'])
    expect(zones.isp).toMatchObject({ status: null, note: 'No hop' })
  })
})

describe('metricText', () => {
  const base = { atLeast: false, pingMs: 40, usualMs: null, lossPct: 2.5, jitterMs: 9.2 }

  it('words each cause with its own figure', () => {
    expect(plain(metricText({ ...base, cause: 'loss' }) ?? undefined)).toBe('2.5% loss')
    expect(plain(metricText({ ...base, cause: 'jitter' }) ?? undefined)).toBe('9.2 ms jitter')
    expect(plain(metricText({ ...base, cause: 'latency' }) ?? undefined)).toBe('Ping of 40 ms')
    expect(
      plain(metricText({ ...base, cause: 'latency', usualMs: 31, atLeast: true }) ?? undefined)
    ).toBe('Ping of ≥ 40 ms against ≥ 31 ms usually')
    expect(metricText({ ...base, cause: null })).toBeNull()
  })
})

describe('match timeline', () => {
  const status = liveStatus({ updatedAt: atMatch(125) })

  it('cuts the match in slices of 30 seconds up to now', () => {
    const cells = timelineCells(status, [])

    expect(cells).toHaveLength(5)
    expect(cells.map(cell => cell.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(cells[4].fromSecs).toBe(120)
  })

  it('marks the slices an incident touches with its status', () => {
    const cells = timelineCells(status, [
      incident({ startedAt: atMatch(40), endedAt: atMatch(95), status: 'degraded' }),
      incident({ id: 2, startedAt: atMatch(80), endedAt: atMatch(85), status: 'critical' }),
    ])

    expect(cells.map(cell => cell.status)).toEqual(['ok', 'degraded', 'critical', 'degraded', 'ok'])
  })

  it('runs an open incident up to now', () => {
    const cells = timelineCells(status, [incident({ startedAt: atMatch(100), endedAt: null })])

    expect(cells.map(cell => cell.status).slice(3)).toEqual(['degraded', 'degraded'])
  })

  it('shows the slices after the last sample as not measured when frozen', () => {
    const cells = timelineCells(
      liveStatus({ state: 'frozen', lastSampleAt: atMatch(65), updatedAt: atMatch(125) }),
      []
    )

    expect(cells.map(cell => cell.status)).toEqual(['ok', 'ok', 'ok', 'unmeasured', 'unmeasured'])
  })

  it('describes the incidents of this match only', () => {
    const own = incident()
    const other = incident({ id: 2, matchStartedAt: atMatch(-3600) })
    const elsewhere = incident({ id: 3, serverIp: '10.0.0.1' })

    expect(matchIncidents(status, [own, other, elsewhere])).toEqual([own])
    expect(timelineEvents(status, [own])).toEqual([
      {
        id: 1,
        status: 'degraded',
        from: '5:00',
        to: '6:00',
        label: '4% loss at RETN',
      },
    ])
  })
})

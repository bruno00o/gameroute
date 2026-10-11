import { describe, expect, it } from 'vitest'

import {
  countsAsBeat,
  emptySeries,
  frozenAge,
  liveScreen,
  matchClock,
  mergeSeries,
  readingBasis,
  readingSeries,
  readingValue,
  referenceText,
  seriesEnd,
  seriesLast,
  seriesWorst,
  trimSeries,
  currentMatch,
  currentTrace,
} from './live'
import { sessionMatches, riotRoute, trace } from '@/test/session-fixtures'
import {
  atMatch,
  gameReading,
  liveStatus,
  reading,
  SERVER,
  waitingStatus,
} from '@/test/live-fixtures'

const point = (second: number, v: number | null) => ({ at: Date.parse(atMatch(second)), v })

describe('liveScreen', () => {
  const idle = { isMonitoring: false, hasGame: false }

  it('follows the backend state when there is a status', () => {
    expect(liveScreen(waitingStatus(), idle)).toBe('waiting')
    expect(liveScreen(liveStatus({ state: 'measuring' }), idle)).toBe('measuring')
    expect(liveScreen(liveStatus(), idle)).toBe('live')
    expect(liveScreen(liveStatus({ state: 'frozen' }), idle)).toBe('frozen')
  })

  it('waits for the match while a game is monitored before the first status', () => {
    expect(liveScreen(null, { isMonitoring: true, hasGame: true })).toBe('waiting')
    expect(liveScreen(null, { isMonitoring: true, hasGame: false })).toBe('idle')
    expect(liveScreen(null, idle)).toBe('idle')
  })
})

describe('readings', () => {
  it('prefixes a lower bound with ≥ and says where the measure stops', () => {
    const floor = reading()
    expect(readingValue(floor)).toBe('≥ 18')
    expect(readingBasis(floor)).toBe('measured up to hop 8 (RETN)')
  })

  it('shows the game ping as an exact value measured by the game', () => {
    const game = gameReading()
    expect(readingValue(game)).toBe('31')
    expect(readingBasis(game)).toBe('measured by the game')
  })

  it('shows a ping measured at the server without a bound', () => {
    const exact = reading({ atLeast: false, basis: { ...reading().basis, atDestination: true } })
    expect(readingValue(exact)).toBe('18')
    expect(readingBasis(exact)).toBe('measured at the server')
  })

  it('shows a dash when nothing is measured', () => {
    expect(readingValue(null)).toBe('—')
    expect(readingValue(reading({ medianMs: null }))).toBe('—')
  })

  it('compares with the usual ping, then with the trace', () => {
    expect(referenceText(reading())).toBe('usual ≥ 17 ms (+1)')
    expect(referenceText(reading({ usual: { medianMs: null, sampleCount: 0 } }))).toBe(
      'trace ≥ 18 ms'
    )
    expect(
      referenceText(reading({ usual: { medianMs: null, sampleCount: 0 }, traceMs: null }))
    ).toBeNull()
  })
})

describe('series', () => {
  it('keeps the last minute only', () => {
    const points = [point(0, 18), point(30, 19), point(61, 20)]
    expect(trimSeries(points).map(p => p.v)).toEqual([19, 20])
  })

  it('merges a seeded minute without duplicating samples', () => {
    const merged = mergeSeries([point(10, 20), point(11, 21)], [point(9, 19), point(10, 20)])
    expect(merged.map(p => p.at)).toEqual([point(9, 0).at, point(10, 0).at, point(11, 0).at])
  })

  it('picks the series of the primary point', () => {
    const series = { floor: [point(1, 18)], game: [point(1, 30), point(2, 31)] }
    expect(readingSeries(series, 'floor')).toBe(series.floor)
    expect(readingSeries(series, 'game')).toBe(series.game)
    expect(readingSeries(series, null)).toBe(series.game)
    expect(readingSeries(emptySeries(), null)).toEqual([])
  })

  it('reads the last and the worst value, ignoring lost probes', () => {
    const points = [point(1, 18), point(2, 40), point(3, null)]
    expect(seriesLast(points)).toBe(40)
    expect(seriesWorst(points)).toBe(40)
    expect(seriesLast([point(1, null)])).toBeNull()
  })

  it('ends the curve at the last sample once frozen', () => {
    const frozen = liveStatus({
      state: 'frozen',
      lastSampleAt: atMatch(590),
      updatedAt: atMatch(600),
    })
    expect(seriesEnd(frozen, [])).toBe(Date.parse(atMatch(590)))
    expect(seriesEnd(liveStatus(), [])).toBe(Date.parse(atMatch(600)))
  })
})

describe('beats', () => {
  it('counts only the samples of the primary measure', () => {
    expect(countsAsBeat('floor', 'floor')).toBe(true)
    expect(countsAsBeat('gateway', 'floor')).toBe(false)
    expect(countsAsBeat('region', 'floor')).toBe(false)
    expect(countsAsBeat('floor', 'game')).toBe(false)
    expect(countsAsBeat('game', 'game')).toBe(true)
    expect(countsAsBeat('gateway', null)).toBe(true)
  })
})

describe('match clock', () => {
  it('counts from the start of the match to the last update', () => {
    expect(matchClock(liveStatus())).toBe('10:00')
    expect(matchClock(waitingStatus())).toBeNull()
  })

  it('dates the freeze from the last sample', () => {
    const frozen = liveStatus({
      state: 'frozen',
      lastSampleAt: atMatch(594),
      updatedAt: atMatch(600),
    })
    expect(frozenAge(frozen)).toBe(6)
  })
})

describe('current match', () => {
  it('finds the match and the trace of the live server', () => {
    const matches = sessionMatches()
    const status = liveStatus({ serverIp: matches[1].ip, matchStartedAt: matches[1].startedAt })
    expect(currentMatch(matches, status)?.number).toBe(2)
    expect(currentMatch(undefined, status)).toBeUndefined()

    const detail = {
      id: 7,
      gameName: 'VALORANT',
      startedAt: matches[0].startedAt,
      endedAt: null,
      ipPeriods: [],
      ipSummaries: [],
      traceroutes: [
        trace(1, SERVER, atMatch(1), riotRoute()),
        trace(2, SERVER, atMatch(30), riotRoute('degraded')),
        trace(3, '203.0.113.9', atMatch(60), riotRoute()),
      ],
    }
    expect(currentTrace(detail, liveStatus())?.id).toBe(2)
    expect(currentTrace(null, liveStatus())).toBeUndefined()
  })
})

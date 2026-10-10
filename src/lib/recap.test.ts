import { describe, expect, it } from 'vitest'

import {
  at,
  matchRecap,
  recapCells,
  recapIncident,
  recapPoint,
  riotRoute,
  sessionMatches,
} from '@/test/session-fixtures'
import {
  hasRecap,
  incidentBasisNote,
  incidentSecs,
  incidentValues,
  incidentWhere,
  matchStartingAt,
  pointLabel,
  pointVolume,
  recapHeadline,
  recapStatus,
  recentMatch,
} from './recap'

const NB = ' '

describe('recapHeadline', () => {
  it('states the game ping, the loss and the longest incident with their numbers', () => {
    expect(recapHeadline(matchRecap())).toBe(
      `13${NB}ms measured by the game, 0.4% loss, 1 incident of 40${NB}s at your ISP at 12:31`
    )
  })

  it('prefixes a floor measure that stopped before the server with ≥ and its hop', () => {
    const recap = matchRecap({
      primary: 'floor',
      points: [matchRecap().points[0]],
      incidents: [],
    })

    expect(recapHeadline(recap)).toBe(`≥${NB}4.7${NB}ms up to hop 5, 0.4% loss, no incident`)
  })

  it('counts the incidents and names the longest', () => {
    const recap = matchRecap({
      incidents: [
        recapIncident({ id: 1, zone: 'isp' }),
        recapIncident({
          id: 2,
          startedAt: at(16, 12),
          endedAt: at(16, 13, 30),
          zone: 'transit',
          operator: 'RETN',
        }),
      ],
    })

    expect(recapHeadline(recap)).toContain(
      `2 incidents, the longest 1${NB}min 30${NB}s at RETN at 18:00`
    )
  })

  it('says so when nothing was measured live', () => {
    const recap = matchRecap({ primary: null, points: [], incidents: [], cells: recapCells(3) })

    expect(recapHeadline(recap)).toBe('No live measurement for this match')
    expect(hasRecap(recap)).toBe(false)
    expect(recapStatus(recap)).toBe('unmeasured')
  })

  it('leaves the loss out when no point could count it', () => {
    const recap = matchRecap({
      points: [recapPoint({ lossPct: null, sent: 0 })],
      incidents: [],
    })

    expect(recapHeadline(recap)).toBe(`13${NB}ms measured by the game, no incident`)
  })
})

describe('recapStatus', () => {
  it('stays ok without incident and takes the worst incident otherwise', () => {
    expect(recapStatus(matchRecap({ incidents: [] }))).toBe('ok')
    expect(
      recapStatus(
        matchRecap({
          incidents: [
            recapIncident({ status: 'watch' }),
            recapIncident({ id: 2, status: 'critical' }),
            recapIncident({ id: 3, status: 'degraded' }),
          ],
        })
      )
    ).toBe('critical')
  })
})

describe('incidents', () => {
  it('measures an open incident up to the end of the match', () => {
    const recap = matchRecap()

    expect(incidentSecs(recapIncident({ endedAt: null }), recap)).toBe(
      Math.round((Date.parse(recap.endedAt) - Date.parse(at(16, 6, 31))) / 1000)
    )
    expect(incidentSecs(recapIncident(), recap)).toBe(40)
  })

  it('names where the fault sits, with the operator only on transit', () => {
    expect(incidentWhere(recapIncident({ zone: 'home' }))).toBe('at your home')
    expect(incidentWhere(recapIncident({ zone: 'isp', operator: 'SFR' }))).toBe('at your ISP')
    expect(incidentWhere(recapIncident({ zone: 'transit', operator: 'RETN' }))).toBe('at RETN')
    expect(incidentWhere(recapIncident({ zone: 'transit', operator: null }))).toBe('on transit')
    expect(incidentWhere(recapIncident({ zone: 'unlocated' }))).toBeNull()
    expect(incidentWhere(recapIncident({ zone: null }))).toBeNull()
  })

  it('keeps ≥ on a lower bound and drops absent figures', () => {
    expect(incidentValues(recapIncident())).toBe(`ping ≥${NB}31${NB}ms, 4% loss`)
    expect(
      incidentValues(recapIncident({ atLeast: false, pingMs: null, lossPct: 0, jitterMs: 9.4 }))
    ).toBe(`jitter 9.4${NB}ms`)
  })

  it('gives the provenance of the figure', () => {
    expect(incidentBasisNote(recapIncident().basis)).toBe('measured up to hop 5')
    expect(incidentBasisNote(recapPoint().basis)).toBe('measured by the game')
    expect(
      incidentBasisNote({ ...recapIncident().basis, atDestination: true, measuredHop: null })
    ).toBeNull()
  })
})

describe('measure points', () => {
  it('labels each point with its provenance', () => {
    const [floor, game] = matchRecap().points

    expect(pointLabel(game)).toBe('Measured by the game')
    expect(pointLabel(floor)).toBe('Up to hop 5')
    expect(pointLabel({ ...floor, basis: { ...floor.basis, measuredHop: 3 } }, riotRoute())).toBe(
      'Up to hop 3 (RETN)'
    )
    expect(pointLabel({ ...floor, point: 'gateway' })).toBe('Your router')
    expect(pointLabel({ ...floor, point: 'isp_edge' })).toBe("Your ISP's last router")
    expect(
      pointLabel({ ...floor, basis: { ...floor.basis, atDestination: true, measuredHop: null } })
    ).toBe('Up to the server')
  })

  it('counts packets for the game and probes for the rest', () => {
    const [floor, game] = matchRecap().points

    expect(pointVolume(game)).toContain('packets')
    expect(pointVolume(floor)).toContain('probes')
    expect(pointVolume({ ...floor, sent: 0 })).toBeNull()
  })
})

describe('recentMatch', () => {
  it('returns the last match when it ended less than an hour ago', () => {
    const matches = sessionMatches()
    const last = matches[matches.length - 1]
    const end = Date.parse(last.endedAt)

    expect(recentMatch(matches, end + 10 * 60_000)).toBe(last)
    expect(recentMatch(matches, end + 90 * 60_000)).toBeUndefined()
    expect(recentMatch([], end)).toBeUndefined()
  })
})

describe('matchStartingAt', () => {
  it('finds the match closest to the start the live status reported', () => {
    const matches = sessionMatches()

    expect(matchStartingAt(matches, matches[1].startedAt)?.number).toBe(2)
    expect(
      matchStartingAt(matches, new Date(Date.parse(matches[2].startedAt) + 800).toISOString())
        ?.number
    ).toBe(3)
    expect(matchStartingAt([], matches[0].startedAt)).toBeUndefined()
  })
})

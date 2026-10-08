import { describe, expect, it } from 'vitest'

import type { SessionMatch } from '@/types/backend'
import {
  at,
  measure,
  riotRoute,
  sessionDetail,
  sessionMatches,
  teamVoice,
  trace,
  RIOT,
} from '@/test/session-fixtures'
import { sessionDiagnostic } from './diagnostic-text'
import { generateSessionExport } from './export-llm'
import { flowServerLabel, formatLoss, sessionVerdict, traceTiming } from './matches'

const NB = ' '

describe('flowServerLabel', () => {
  it('names the operator and port without a city for Riot', () => {
    expect(flowServerLabel(sessionMatches()[0])).toBe('Riot Games · UDP 7284')
  })

  it('keeps the city of a voice server', () => {
    expect(flowServerLabel(teamVoice())).toBe('Microsoft · Paris · UDP 27020')
  })

  it('falls back to the address when the operator is unknown', () => {
    expect(flowServerLabel({ ...sessionMatches()[0], operator: null })).toBe(`${RIOT} · UDP 7284`)
  })
})

describe('formatLoss', () => {
  it('keeps one decimal only for small fractional losses', () => {
    expect(formatLoss(0)).toBe('0%')
    expect(formatLoss(0.4)).toBe('0.4%')
    expect(formatLoss(33.3)).toBe('33%')
    expect(formatLoss(null)).toBe('—')
  })
})

describe('traceTiming', () => {
  const matches = sessionMatches()
  const detail = sessionDetail()

  it('gives the offset when the trace ran during the match', () => {
    expect(traceTiming(matches[0], matches, detail.endedAt)).toEqual({
      kind: 'during',
      offsetSecs: 41,
    })
  })

  it('names the match a shared trace comes from', () => {
    expect(traceTiming(matches[1], matches, detail.endedAt)).toEqual({ kind: 'match', number: 1 })
  })

  it('says when the trace ran after the session', () => {
    const late = { ...matches[1], trace: measure({ startedAt: at(20, 30) }) }
    expect(traceTiming(late, matches, detail.endedAt)).toEqual({ kind: 'after' })
  })

  it('gives the time of a trace taken between matches', () => {
    const between = { ...matches[1], trace: measure({ startedAt: at(15, 53) }) }
    expect(traceTiming(between, matches, detail.endedAt)).toEqual({ kind: 'at', time: at(15, 53) })
  })
})

describe('sessionVerdict', () => {
  it('has nothing to say without matches', () => {
    expect(sessionVerdict([], [])).toBeNull()
  })

  it('blames the ping when the loss stays under its threshold', () => {
    const thresholds = {
      watch: { lossPct: 0.5, jitterMs: 8, overBaselineMs: 20, rttMs: 60 },
      degraded: { lossPct: 2, jitterMs: 15, overBaselineMs: 50, rttMs: 100 },
      critical: { lossPct: 5, jitterMs: 30, overBaselineMs: 100, rttMs: 150 },
    }
    const matches: SessionMatch[] = sessionMatches().map(match =>
      match.number === 1
        ? { ...match, status: 'degraded', trace: measure({ pingMs: 112, lossPct: 0.3 }) }
        : match
    )

    const verdict = sessionVerdict(matches, sessionDetail().traceroutes, thresholds)!

    expect(verdict.status).toBe('degraded')
    expect(verdict.title).toBe(`≥${NB}112${NB}ms ping during match 1`)
    expect(verdict.sentences[0]).toBe(`RETN adds the most: +14${NB}ms.`)
    expect(verdict.zone).toBeNull()
  })

  it('hides the rest of the route behind a router that loses packets', () => {
    const route = riotRoute()
    route.segments[0].status = 'critical'
    const matches: SessionMatch[] = sessionMatches().map(match =>
      match.trace ? { ...match, status: 'critical', trace: measure({ lossPct: 9 }) } : match
    )

    const verdict = sessionVerdict(matches, [trace(11, RIOT, at(15, 45, 41), route)])!

    expect(verdict.title).toBe('9% loss at home during matches 1 and 2')
    expect(verdict.zone).toBe('home')
    expect(verdict.zones!.home).toMatchObject({ status: 'critical', note: '9% loss' })
    expect(verdict.zones!.isp).toMatchObject({ status: 'unmeasured', note: 'Hidden by the router' })
    expect(verdict.sentences).toContain(
      'On Wi-Fi, move closer to your router or switch to an Ethernet cable.'
    )
  })
})

describe('sessionDiagnostic', () => {
  it('writes a readable summary in the language of the app', () => {
    const text = sessionDiagnostic(sessionDetail(), sessionMatches())
    const lines = text.split('\n')

    expect(lines[0]).toBe('GameRoute diagnostic · VALORANT')
    expect(lines[1]).toMatch(/15:40 → 20:14 · 4\sh 34\smin$/)
    expect(text).toContain(`Good · ≥${NB}18${NB}ms to the server, no loss`)
    expect(text).toContain(
      `Your home +0.6${NB}ms → Your ISP · SFR (AS15557) +3.0${NB}ms → Transit · RETN (AS9002) +14${NB}ms → Riot Games (doesn't answer pings) = ≥${NB}18${NB}ms`
    )
    expect(text).toContain(
      `1. 15:45 · 6:36 · Riot Games · UDP 7284 · ping ≥${NB}18${NB}ms (measured up to hop 3 (RETN), trace at 0:41) · loss 0% · jitter 1.0${NB}ms · Good · voice Microsoft · Paris · UDP 27020: 14${NB}ms`
    )
    expect(text).toContain(
      '3. 16:27 · 42:36 · Riot Games · UDP 7220 · ping — · loss — · jitter — · Not measurable'
    )
    expect(lines[lines.length - 1]).toBe(
      'Ping, loss and jitter come from one trace per server. Jitter is the spread of its 3 probes.'
    )
  })

  it('says so when the session has no match', () => {
    const text = sessionDiagnostic(sessionDetail({ ipPeriods: [], traceroutes: [] }), [])
    expect(text.split('\n').slice(-1)[0]).toBe('No match in this session')
  })
})

describe('generateSessionExport', () => {
  it('adds the matches and the route by operator for the AI', () => {
    const text = generateSessionExport(sessionDetail(), sessionMatches())

    expect(text).toContain('<matches>')
    expect(text).toContain(
      `- Match 1, started ${new Date(at(15, 45))
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, ' UTC')}: ${RIOT} UDP:7284 (Riot Games, Inc, AS6507)`
    )
    expect(text).toContain(`ping >= 17.6${NB}ms up to hop 3 (server silent)`)
    expect(text).toContain('  Voice: 20.47.65.180 UDP:27020 (Microsoft Corporation, AS8075, Paris)')
    expect(text).toContain('<routes-by-operator>')
    expect(text).toContain('transit RETN Limited AS9002 +14.0 ms (hops 3-4)')
  })
})

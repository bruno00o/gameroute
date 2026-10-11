import { describe, expect, it } from 'vitest'

import type { TracerouteHopEvent } from '@/types/backend'
import {
  isValidTraceAddress,
  liveHopToDbHop,
  targetPortLabel,
  targetRoleLabel,
  traceState,
} from './trace'

describe('isValidTraceAddress', () => {
  it.each(['162.249.72.1', ' 8.8.8.8 ', '2606:4700:4700::1111', 'example.com', 'eu.example.net.'])(
    'accepts %s',
    input => {
      expect(isValidTraceAddress(input)).toBe(true)
    }
  )

  it.each([
    '',
    '   ',
    'localhost',
    '162.249.72',
    '999.1.1.1',
    '1.2.3.4.5',
    'exa mple.com',
    '-bad.example.com',
    'example..com',
    'http://example.com',
    'example.com/path',
    'example.com:443',
    '12345',
  ])('rejects %j', input => {
    expect(isValidTraceAddress(input)).toBe(false)
  })
})

describe('liveHopToDbHop', () => {
  const event: TracerouteHopEvent = {
    serverIpIndex: 1,
    targetIp: '162.249.72.1',
    hopNumber: 4,
    ip: '77.136.10.6',
    hostname: null,
    rttMs: 4.2,
    rttMin: 4,
    rttMax: 6,
    packetLoss: 33.3,
    timeout: false,
  }

  it('keeps the measures of a router that answers and leaves the loss status to the backend', () => {
    expect(liveHopToDbHop(event)).toMatchObject({
      hopNumber: 4,
      ip: '77.136.10.6',
      latencyMin: 4,
      latencyAvg: 4.2,
      latencyMax: 6,
      packetLoss: 33.3,
      lossStatus: null,
    })
  })

  it('turns a silent hop into a hop without latency', () => {
    const hop = liveHopToDbHop({
      ...event,
      ip: null,
      rttMs: null,
      rttMin: null,
      rttMax: null,
      packetLoss: 100,
      timeout: true,
    })

    expect(hop.ip).toBeNull()
    expect(hop.latencyAvg).toBeNull()
  })
})

describe('traceState', () => {
  it('follows the life of a target', () => {
    expect(traceState({ hops: 0, result: undefined, current: false })).toBe('queued')
    expect(traceState({ hops: 0, result: undefined, current: true })).toBe('running')
    expect(traceState({ hops: 2, result: undefined, current: false })).toBe('running')
    expect(traceState({ hops: 2, result: { success: true }, current: true })).toBe('done')
    expect(traceState({ hops: 0, result: { success: false }, current: false })).toBe('failed')
  })
})

describe('target labels', () => {
  it('names the role of each target', () => {
    const base = { ip: '1.1.1.1', protocol: 'UDP', port: 7220 }
    expect(targetRoleLabel({ ...base, kind: 'game' })).toBe('Game server')
    expect(targetRoleLabel({ ...base, kind: 'voice' })).toBe('Voice chat')
    expect(targetRoleLabel({ ...base, kind: 'other' })).toBe('Other connection')
    expect(targetRoleLabel({ ...base, kind: null })).toBe('Entered address')
  })

  it('shows the port only when there is one', () => {
    expect(targetPortLabel({ ip: '1.1.1.1', kind: 'game', protocol: 'UDP', port: 7220 })).toBe(
      'UDP 7220'
    )
    expect(targetPortLabel({ ip: '1.1.1.1', kind: null, protocol: 'ICMP', port: 0 })).toBeNull()
    expect(targetPortLabel(undefined)).toBeNull()
  })
})

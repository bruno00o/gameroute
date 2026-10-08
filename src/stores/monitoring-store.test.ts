import { afterEach, describe, expect, it } from 'vitest'
import { useMonitoringStore } from './monitoring-store'
import type { MonitoringStatusResponse, ServerIpCapturedEvent } from '@/types/backend'

const { getState } = useMonitoringStore

afterEach(() => {
  getState().reset()
})

describe('monitoring-store initial state', () => {
  it('starts idle', () => {
    const state = getState()
    expect(state.isMonitoring).toBe(false)
    expect(state.currentGame).toBeNull()
    expect(state.isManualMode).toBe(false)
    expect(state.currentSessionId).toBeNull()
    expect(state.seenIps.size).toBe(0)
    expect(state.serverIpCount).toBe(0)
  })
})

describe('setStatus', () => {
  it('sets monitoring status from backend response', () => {
    const status: MonitoringStatusResponse = {
      isMonitoring: true,
      currentGame: {
        gameName: 'Valorant',
        pid: 1234,
        detectedAt: '2026-01-31T10:00:00Z',
        exePath: null,
        icon: null,
        isManual: false,
      },
      isManualMode: false,
      currentSessionId: 42,
    }

    getState().setStatus(status)

    expect(getState().isMonitoring).toBe(true)
    expect(getState().currentGame?.gameName).toBe('Valorant')
    expect(getState().isManualMode).toBe(false)
    expect(getState().currentSessionId).toBe(42)
  })

  it('sets manual mode status', () => {
    const status: MonitoringStatusResponse = {
      isMonitoring: true,
      currentGame: {
        gameName: 'Unknown',
        pid: 5678,
        detectedAt: '2026-01-31T10:00:00Z',
        exePath: null,
        icon: null,
        isManual: true,
      },
      isManualMode: true,
      currentSessionId: null,
    }

    getState().setStatus(status)

    expect(getState().isManualMode).toBe(true)
    expect(getState().currentGame?.isManual).toBe(true)
  })

  it('clears game when not monitoring', () => {
    getState().setStatus({
      isMonitoring: true,
      currentGame: {
        gameName: 'Valorant',
        pid: 1234,
        detectedAt: '2026-01-31T10:00:00Z',
        exePath: null,
        icon: null,
        isManual: false,
      },
      isManualMode: false,
      currentSessionId: 42,
    })

    getState().setStatus({
      isMonitoring: false,
      currentGame: null,
      isManualMode: false,
      currentSessionId: null,
    })

    expect(getState().isMonitoring).toBe(false)
    expect(getState().currentGame).toBeNull()
    expect(getState().currentSessionId).toBeNull()
  })
})

describe('addCapturedIp', () => {
  it('adds an IP event and increments count', () => {
    const event: ServerIpCapturedEvent = {
      ip: '192.168.1.1',
      port: 443,
      protocol: 'tcp',
      capturedAt: '2026-01-31T10:00:00Z',
      packetCount: null,
    }

    getState().addCapturedIp(event)

    expect(getState().seenIps.size).toBe(1)
    expect(getState().seenIps.has('192.168.1.1')).toBe(true)
    expect(getState().serverIpCount).toBe(1)
  })

  it('accumulates multiple IPs', () => {
    getState().addCapturedIp({
      ip: '10.0.0.1',
      port: 80,
      protocol: 'tcp',
      capturedAt: '2026-01-31T10:00:00Z',
      packetCount: null,
    })
    getState().addCapturedIp({
      ip: '10.0.0.2',
      port: 443,
      protocol: 'udp',
      capturedAt: '2026-01-31T10:00:05Z',
      packetCount: null,
    })

    expect(getState().seenIps.size).toBe(2)
    expect(getState().serverIpCount).toBe(2)
  })
})

describe('clearCapturedIps', () => {
  it('resets captured IPs and count', () => {
    getState().addCapturedIp({
      ip: '10.0.0.1',
      port: 80,
      protocol: 'tcp',
      capturedAt: '2026-01-31T10:00:00Z',
      packetCount: null,
    })
    getState().addCapturedIp({
      ip: '10.0.0.2',
      port: 443,
      protocol: 'udp',
      capturedAt: '2026-01-31T10:00:05Z',
      packetCount: null,
    })

    getState().clearCapturedIps()

    expect(getState().seenIps.size).toBe(0)
    expect(getState().serverIpCount).toBe(0)
  })
})

describe('reset', () => {
  it('resets to initial state', () => {
    getState().setStatus({
      isMonitoring: true,
      currentGame: {
        gameName: 'Valorant',
        pid: 1234,
        detectedAt: '2026-01-31T10:00:00Z',
        exePath: null,
        icon: null,
        isManual: false,
      },
      isManualMode: false,
      currentSessionId: 42,
    })
    getState().addCapturedIp({
      ip: '10.0.0.1',
      port: 80,
      protocol: 'tcp',
      capturedAt: '2026-01-31T10:00:00Z',
      packetCount: null,
    })

    getState().reset()

    expect(getState().isMonitoring).toBe(false)
    expect(getState().currentGame).toBeNull()
    expect(getState().isManualMode).toBe(false)
    expect(getState().currentSessionId).toBeNull()
    expect(getState().seenIps.size).toBe(0)
    expect(getState().serverIpCount).toBe(0)
  })
})

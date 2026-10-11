import { describe, expect, it } from 'vitest'

import { liveStateLabel, monitorLabel } from './live-state'

describe('liveStateLabel', () => {
  it('names each live state', () => {
    expect(liveStateLabel('live')).toBe('In match')
    expect(liveStateLabel('measuring')).toBe('Measuring')
    expect(liveStateLabel('idle')).toBe('Idle')
    expect(liveStateLabel('stale')).toBe('Signal frozen')
  })
})

describe('monitorLabel', () => {
  it('says monitoring is stopped before anything else', () => {
    expect(monitorLabel({ liveState: 'idle', isMonitoring: false, isManualMode: false })).toBe(
      'Monitoring stopped'
    )
  })

  it('uses the live state word while monitoring', () => {
    expect(monitorLabel({ liveState: 'idle', isMonitoring: true, isManualMode: false })).toBe(
      'Idle'
    )
    expect(monitorLabel({ liveState: 'measuring', isMonitoring: true, isManualMode: false })).toBe(
      'Measuring'
    )
    expect(monitorLabel({ liveState: 'live', isMonitoring: true, isManualMode: false })).toBe(
      'In match'
    )
    expect(monitorLabel({ liveState: 'stale', isMonitoring: true, isManualMode: false })).toBe(
      'Signal frozen'
    )
  })

  it('does not call a manually picked program a match', () => {
    expect(monitorLabel({ liveState: 'live', isMonitoring: true, isManualMode: true })).toBe('Live')
  })
})

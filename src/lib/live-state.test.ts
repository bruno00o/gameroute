import { describe, expect, it } from 'vitest'

import { liveStateLabel } from './live-state'

describe('liveStateLabel', () => {
  it('names each live state', () => {
    expect(liveStateLabel('live')).toBe('In match')
    expect(liveStateLabel('measuring')).toBe('Measuring')
    expect(liveStateLabel('idle')).toBe('Idle')
    expect(liveStateLabel('stale')).toBe('Signal frozen')
  })
})

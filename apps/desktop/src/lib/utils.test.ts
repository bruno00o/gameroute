import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('keeps a v2 text size next to a text colour', () => {
    expect(cn('text-label', 'text-muted-foreground')).toBe('text-label text-muted-foreground')
    expect(cn('text-data-sm', 'text-signal')).toBe('text-data-sm text-signal')
  })

  it('lets a later text size win', () => {
    expect(cn('text-xs', 'text-ui')).toBe('text-ui')
    expect(cn('text-readout', 'text-readout-xl')).toBe('text-readout-xl')
  })

  it('lets a later status colour win', () => {
    expect(cn('text-ok', 'text-critical')).toBe('text-critical')
  })
})

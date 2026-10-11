import { describe, expect, it } from 'vitest'

import { addSample } from '@/components/mini/use-mini-live'
import { MINI_WINDOW_MS, appendSample, sourceOf, type MiniSample } from '@/lib/mini'

const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('Mini window samples', () => {
  it('keeps one minute of samples, lost ones included', () => {
    let samples: MiniSample[] = []
    for (let second = 0; second <= 90; second++) {
      samples = appendSample(samples, { at: second * 1000, rttMs: second % 10 ? 18 : null })
    }

    expect(samples[0].at).toBe(90_000 - MINI_WINDOW_MS)
    expect(samples).toHaveLength(61)
    expect(samples.filter(sample => sample.rttMs == null)).toHaveLength(7)
  })

  it('drops samples that arrive out of order or without a time', () => {
    const samples = appendSample([{ at: 5000, rttMs: 18 }], { at: 4000, rttMs: 19 })

    expect(samples).toEqual([{ at: 4000, rttMs: 19 }])
    expect(appendSample(samples, { at: Number.NaN, rttMs: 1 })).toBe(samples)
  })

  it('files each sample under the point that measured it', () => {
    const tracks = addSample(
      addSample({}, { source: 'floor', measuredAt: '2026-10-09T21:00:00Z', rttMs: 18 }),
      { source: 'game', measuredAt: '2026-10-09T21:00:01Z', rttMs: 38 }
    )

    expect(tracks[sourceOf('floor')]?.samples).toHaveLength(1)
    expect(tracks[sourceOf('game')]?.last.rttMs).toBe(38)
  })
})

describe('Opening the mini window', () => {
  it('only happens from the settings button', () => {
    const callers = Object.entries(sources)
      .filter(([file, text]) => file !== '/src/lib/tauri.ts' && /\bshowMiniWindow\b/.test(text))
      .map(([file]) => file)

    expect(callers).toEqual(['/src/components/settings/mini-window-settings.tsx'])
  })
})

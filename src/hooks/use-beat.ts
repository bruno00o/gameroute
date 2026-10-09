import { useState } from 'react'

export function useBeat(sample: unknown) {
  const [seen, setSeen] = useState({ sample, beat: 0 })
  if (Object.is(seen.sample, sample)) return seen.beat
  const next = { sample, beat: seen.beat + 1 }
  setSeen(next)
  return next.beat
}

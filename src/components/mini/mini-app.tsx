import { useEffect, useState } from 'react'

import { getMiniState, hideMiniWindow, setMiniCollapsed } from '@/lib/tauri'
import { sourceOf } from '@/lib/mini'
import { MiniWindow } from '@/components/mini/mini-window'
import { useMiniLive, useNow } from '@/components/mini/use-mini-live'

export function MiniApp() {
  const { status, tracks } = useMiniLive()
  const now = useNow()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    getMiniState()
      .then(state => setCollapsed(state.collapsed))
      .catch(() => {})
  }, [])

  const primary = status?.primary
  const track = primary ? tracks[sourceOf(primary.point)] : undefined

  const handleCollapsedChange = (next: boolean) => {
    setCollapsed(next)
    setMiniCollapsed(next).catch(e => console.warn('[mini] Failed to resize:', e))
  }

  return (
    <MiniWindow
      status={status}
      samples={track?.samples ?? []}
      sample={track?.last}
      now={now}
      collapsed={collapsed}
      onCollapsedChange={handleCollapsedChange}
      onClose={() => {
        hideMiniWindow().catch(e => console.warn('[mini] Failed to close:', e))
      }}
    />
  )
}

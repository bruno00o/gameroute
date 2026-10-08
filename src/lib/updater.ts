import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { create, type StoreApi } from 'zustand'

import { useMonitoringStore } from '@/stores/monitoring-store'
import { useTraceStore } from '@/stores/trace-store'

export const STARTUP_GRACE_MS = 30_000
export const POST_MATCH_SETTLE_MS = 5_000
export const POST_MATCH_TRACE_CAP_MS = 5 * 60_000

type UpdateStore = {
  pending: Update | null
  checkedAt: string | null
}

export const useUpdateStore = create<UpdateStore>(() => ({ pending: null, checkedAt: null }))

let startupCheckStarted = false
let prompted = false

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function waitUntil<T>(store: StoreApi<T>, isDone: (state: T) => boolean): Promise<void> {
  return new Promise(resolve => {
    if (isDone(store.getState())) return resolve()
    const unsubscribe = store.subscribe(state => {
      if (!isDone(state)) return
      unsubscribe()
      resolve()
    })
  })
}

async function waitForMatchEnd() {
  while (useMonitoringStore.getState().currentGame) {
    await waitUntil(useMonitoringStore, s => !s.currentGame)
    await Promise.race([
      sleep(POST_MATCH_SETTLE_MS).then(() => waitUntil(useTraceStore, s => !s.isRunning)),
      sleep(POST_MATCH_TRACE_CAP_MS),
    ])
  }
}

async function checkNow(): Promise<Update | null> {
  const update = await check()
  useUpdateStore.setState({ checkedAt: new Date().toISOString() })
  return update
}

function promptForUpdate(update: Update) {
  prompted = true
  useUpdateStore.setState({ pending: update })
}

export function dismissUpdate() {
  useUpdateStore.setState({ pending: null })
}

export async function installUpdate(): Promise<void> {
  const update = useUpdateStore.getState().pending
  if (!update) return
  await update.downloadAndInstall()
  await relaunch()
}

export async function checkForAppUpdates(): Promise<boolean> {
  const update = await checkNow()
  if (!update) return false
  promptForUpdate(update)
  return true
}

export async function checkForAppUpdatesOnStartup(): Promise<void> {
  if (startupCheckStarted) return
  startupCheckStarted = true
  const graceElapsed = sleep(STARTUP_GRACE_MS)

  try {
    const update = await checkNow()
    if (!update) return
    await graceElapsed
    await waitForMatchEnd()
    if (!prompted) promptForUpdate(update)
  } catch (e) {
    console.error('Update check failed:', e)
  }
}

const COMMIT_LINK = /\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)\s*$/i
const SCOPE = /^\*\*[^*]+:\*\*\s*/
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]*\)/g

function plainNote(markdown: string): string {
  const text = markdown
    .replace(COMMIT_LINK, '')
    .replace(SCOPE, '')
    .replace(MARKDOWN_LINK, '$1')
    .replace(/\*\*/g, '')
    .trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function releaseNotes(body: string | undefined): string[] {
  const lines = (body ?? '').split(/\r?\n/).map(line => line.trim())
  const items = lines.flatMap(line => /^[*-]\s+(.+)$/.exec(line)?.[1] ?? [])
  const notes = items.length > 0 ? items : lines.filter(line => line && !line.startsWith('#'))
  return notes.map(plainNote).filter(Boolean)
}

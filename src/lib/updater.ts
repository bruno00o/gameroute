import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { ask } from '@tauri-apps/plugin-dialog'
import type { StoreApi } from 'zustand'

import * as m from '@/paraglide/messages'
import { useMonitoringStore } from '@/stores/monitoring-store'
import { useTraceStore } from '@/stores/trace-store'

export const STARTUP_GRACE_MS = 30_000
export const POST_MATCH_SETTLE_MS = 5_000
export const POST_MATCH_TRACE_CAP_MS = 5 * 60_000

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

async function promptForUpdate(update: Update) {
  prompted = true
  const game = useMonitoringStore.getState().currentGame?.gameName
  const details = `v${update.version}\n\n${update.body ?? ''}`

  const yes = await ask(game ? `${m.updater_match_warning({ game })}\n\n${details}` : details, {
    title: m.updater_title(),
    kind: game ? 'warning' : 'info',
    okLabel: m.updater_update_now(),
    cancelLabel: m.updater_later(),
  })

  if (yes) {
    await update.downloadAndInstall()
    await relaunch()
  }
}

export async function checkForAppUpdates(): Promise<boolean> {
  const update = await check()
  if (!update) return false
  await promptForUpdate(update)
  return true
}

export async function checkForAppUpdatesOnStartup(): Promise<void> {
  if (startupCheckStarted) return
  startupCheckStarted = true
  const graceElapsed = sleep(STARTUP_GRACE_MS)

  try {
    const update = await check()
    if (!update) return
    await graceElapsed
    await waitForMatchEnd()
    if (!prompted) await promptForUpdate(update)
  } catch (e) {
    console.error('Update check failed:', e)
  }
}

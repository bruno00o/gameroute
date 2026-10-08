import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { ask } from '@tauri-apps/plugin-dialog'

import * as m from '@/paraglide/messages'
import { useMonitoringStore } from '@/stores/monitoring-store'

export const STARTUP_GRACE_MS = 30_000

let startupCheckStarted = false
let prompted = false

function waitForGameEnd(): Promise<void> {
  return new Promise(resolve => {
    if (!useMonitoringStore.getState().currentGame) return resolve()
    const unsubscribe = useMonitoringStore.subscribe(state => {
      if (state.currentGame) return
      unsubscribe()
      resolve()
    })
  })
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
  const graceElapsed = new Promise(resolve => setTimeout(resolve, STARTUP_GRACE_MS))

  try {
    const update = await check()
    if (!update) return
    await graceElapsed
    await waitForGameEnd()
    if (!prompted) await promptForUpdate(update)
  } catch (e) {
    console.error('Update check failed:', e)
  }
}

import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { ask } from '@tauri-apps/plugin-dialog'

import * as m from '@/paraglide/messages'

export async function checkForAppUpdates(silent = false): Promise<boolean> {
  try {
    const update = await check()
    if (!update?.available) return false

    const yes = await ask(`v${update.version}\n\n${update.body ?? ''}`, {
      title: m.updater_title(),
      kind: 'info',
      okLabel: m.updater_update_now(),
      cancelLabel: m.updater_later(),
    })

    if (yes) {
      await update.downloadAndInstall()
      await relaunch()
    }

    return true
  } catch (e) {
    if (!silent) throw e
    console.error('Update check failed:', e)
    return false
  }
}

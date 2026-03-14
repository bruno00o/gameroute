import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { ask } from '@tauri-apps/plugin-dialog'

export async function checkForAppUpdates(silent = false): Promise<boolean> {
  try {
    const update = await check()
    if (!update?.available) return false

    const yes = await ask(
      `v${update.version}\n\n${update.body ?? ''}`,
      {
        title: 'GameRoute — Update Available',
        kind: 'info',
        okLabel: 'Update now',
        cancelLabel: 'Later',
      },
    )

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

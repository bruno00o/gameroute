import { afterEach, describe, expect, it, vi } from 'vitest'
import { setMinimizeToTray } from '@/lib/tauri'
import { migrateSettings, useSettingsStore } from './settings-store'

vi.mock('@/lib/tauri', () => ({ setMinimizeToTray: vi.fn(() => Promise.resolve()) }))

const { getState } = useSettingsStore

describe('settings migration', () => {
  afterEach(() => {
    vi.mocked(setMinimizeToTray).mockClear()
    localStorage.clear()
  })

  it('moves a disabled notification area setting to the app', () => {
    const migrated = migrateSettings(
      {
        autoStartMonitoring: false,
        onboardingCompleted: true,
        minimizeToTray: false,
        advancedMode: true,
      },
      0
    )

    expect(setMinimizeToTray).toHaveBeenCalledWith(false)
    expect(migrated).toEqual({
      autoStartMonitoring: false,
      onboardingCompleted: true,
      advancedMode: true,
    })
  })

  it('leaves the default notification area setting alone', () => {
    migrateSettings({ minimizeToTray: true }, 0)
    migrateSettings({ minimizeToTray: false }, 1)

    expect(setMinimizeToTray).not.toHaveBeenCalled()
  })

  it('keeps every saved setting when an older version loads', async () => {
    localStorage.setItem(
      'gameroute-settings',
      JSON.stringify({
        state: {
          autoStartMonitoring: false,
          onboardingCompleted: true,
          minimizeToTray: false,
          advancedMode: true,
        },
        version: 0,
      })
    )
    vi.resetModules()

    const { useSettingsStore: reloaded } = await import('./settings-store')
    const { setMinimizeToTray: pushed } = await import('@/lib/tauri')

    expect(reloaded.getState()).toMatchObject({
      autoStartMonitoring: false,
      onboardingCompleted: true,
      advancedMode: true,
    })
    expect(pushed).toHaveBeenCalledWith(false)
    expect(JSON.parse(localStorage.getItem('gameroute-settings')!).state).not.toHaveProperty(
      'minimizeToTray'
    )
  })
})

afterEach(() => {
  // Reset to defaults
  getState().setAutoStartMonitoring(true)
})

describe('settings-store initial state', () => {
  it('has auto-start enabled by default', () => {
    expect(getState().autoStartMonitoring).toBe(true)
  })

  it('starts with locale version 0', () => {
    expect(getState()._localeVersion).toBeGreaterThanOrEqual(0)
  })
})

describe('setAutoStartMonitoring', () => {
  it('toggles auto-start off', () => {
    getState().setAutoStartMonitoring(false)
    expect(getState().autoStartMonitoring).toBe(false)
  })

  it('toggles auto-start back on', () => {
    getState().setAutoStartMonitoring(false)
    getState().setAutoStartMonitoring(true)
    expect(getState().autoStartMonitoring).toBe(true)
  })
})

describe('bumpLocaleVersion', () => {
  it('increments locale version', () => {
    const before = getState()._localeVersion
    getState().bumpLocaleVersion()
    expect(getState()._localeVersion).toBe(before + 1)
  })

  it('increments monotonically', () => {
    const before = getState()._localeVersion
    getState().bumpLocaleVersion()
    getState().bumpLocaleVersion()
    getState().bumpLocaleVersion()
    expect(getState()._localeVersion).toBe(before + 3)
  })
})

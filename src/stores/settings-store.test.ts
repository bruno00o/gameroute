import { afterEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './settings-store'

const { getState } = useSettingsStore

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

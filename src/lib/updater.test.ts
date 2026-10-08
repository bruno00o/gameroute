import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedGame } from '@/types/backend'

const { check, relaunch } = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }))

const game: DetectedGame = {
  gameName: 'Valorant',
  pid: 1234,
  detectedAt: '2026-10-08T10:00:00Z',
  exePath: null,
  icon: null,
  isManual: false,
}

function makeUpdate() {
  return {
    currentVersion: '1.2.2',
    version: '1.2.3',
    body: 'Release notes',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  }
}

async function load() {
  const updater = await import('./updater')
  const { useMonitoringStore } = await import('@/stores/monitoring-store')
  const { useTraceStore } = await import('@/stores/trace-store')
  const prompt = vi.fn()
  updater.useUpdateStore.subscribe((state, previous) => {
    if (state.pending && state.pending !== previous.pending) prompt(state.pending.version)
  })
  return {
    ...updater,
    prompt,
    startGame: () => useMonitoringStore.setState({ currentGame: game, isMonitoring: true }),
    endGame: () => useMonitoringStore.setState({ currentGame: null }),
    startTraces: () => useTraceStore.setState({ isRunning: true }),
    finishTraces: () => useTraceStore.setState({ isRunning: false }),
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  check.mockReset()
  relaunch.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checkForAppUpdatesOnStartup', () => {
  it('prompts as soon as the grace period ends when no game is monitored', async () => {
    const { checkForAppUpdatesOnStartup, prompt, STARTUP_GRACE_MS } = await load()
    check.mockResolvedValue(makeUpdate())

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS - 1)
    expect(prompt).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(prompt).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledWith('1.2.3')
  })

  it('does not prompt while a game is monitored and prompts once it ends', async () => {
    const {
      checkForAppUpdatesOnStartup,
      prompt,
      startGame,
      endGame,
      STARTUP_GRACE_MS,
      POST_MATCH_SETTLE_MS,
    } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS * 10)
    expect(prompt).not.toHaveBeenCalled()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS - 1)
    expect(prompt).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('defers the prompt when a game is detected during the grace period', async () => {
    const {
      checkForAppUpdatesOnStartup,
      prompt,
      startGame,
      endGame,
      STARTUP_GRACE_MS,
      POST_MATCH_SETTLE_MS,
    } = await load()
    check.mockResolvedValue(makeUpdate())

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS / 2)
    startGame()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS * 10)
    expect(prompt).not.toHaveBeenCalled()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS)
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('waits for the post-match traceroutes to finish', async () => {
    const {
      checkForAppUpdatesOnStartup,
      prompt,
      startGame,
      endGame,
      startTraces,
      finishTraces,
      STARTUP_GRACE_MS,
      POST_MATCH_SETTLE_MS,
    } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS / 2)
    startTraces()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS * 10)
    expect(prompt).not.toHaveBeenCalled()

    finishTraces()
    await vi.advanceTimersByTimeAsync(0)
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('prompts at the cap when a traceroute never finishes', async () => {
    const {
      checkForAppUpdatesOnStartup,
      prompt,
      startGame,
      endGame,
      startTraces,
      STARTUP_GRACE_MS,
      POST_MATCH_TRACE_CAP_MS,
    } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()
    startTraces()

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_TRACE_CAP_MS - 1)
    expect(prompt).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('keeps waiting when a new game starts during the post-match traceroutes', async () => {
    const {
      checkForAppUpdatesOnStartup,
      prompt,
      startGame,
      endGame,
      startTraces,
      finishTraces,
      STARTUP_GRACE_MS,
      POST_MATCH_SETTLE_MS,
    } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()
    startTraces()

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS)
    startGame()
    finishTraces()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS * 10)
    expect(prompt).not.toHaveBeenCalled()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS)
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('prompts at most once per run', async () => {
    const { checkForAppUpdatesOnStartup, prompt, startGame, endGame, STARTUP_GRACE_MS } =
      await load()
    check.mockResolvedValue(makeUpdate())

    checkForAppUpdatesOnStartup()
    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    expect(check).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledOnce()

    startGame()
    endGame()
    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS * 10)
    expect(check).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('skips the deferred prompt when the update was already offered from Settings', async () => {
    const {
      checkForAppUpdates,
      checkForAppUpdatesOnStartup,
      prompt,
      startGame,
      endGame,
      STARTUP_GRACE_MS,
      POST_MATCH_TRACE_CAP_MS,
    } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    await checkForAppUpdates()
    expect(prompt).toHaveBeenCalledOnce()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_TRACE_CAP_MS)
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('does not prompt when no update is available', async () => {
    const { checkForAppUpdatesOnStartup, prompt, useUpdateStore, STARTUP_GRACE_MS } = await load()
    check.mockResolvedValue(null)

    await checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    expect(prompt).not.toHaveBeenCalled()
    expect(useUpdateStore.getState().checkedAt).not.toBeNull()
  })

  it('swallows update check errors', async () => {
    const { checkForAppUpdatesOnStartup, prompt, useUpdateStore } = await load()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    check.mockRejectedValue(new Error('offline'))

    await expect(checkForAppUpdatesOnStartup()).resolves.toBeUndefined()
    expect(prompt).not.toHaveBeenCalled()
    expect(useUpdateStore.getState().checkedAt).toBeNull()
    consoleError.mockRestore()
  })
})

describe('checkForAppUpdates', () => {
  it('prompts immediately, even while a game is monitored', async () => {
    const { checkForAppUpdates, prompt, startGame } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()

    await expect(checkForAppUpdates()).resolves.toBe(true)
    expect(prompt).toHaveBeenCalledWith('1.2.3')
  })

  it('returns false without prompting when no update is available', async () => {
    const { checkForAppUpdates, prompt } = await load()
    check.mockResolvedValue(null)

    await expect(checkForAppUpdates()).resolves.toBe(false)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('lets the update error reach the caller', async () => {
    const { checkForAppUpdates } = await load()
    check.mockRejectedValue(new Error('offline'))

    await expect(checkForAppUpdates()).rejects.toThrow('offline')
  })
})

describe('installUpdate and dismissUpdate', () => {
  it('installs the offered update and relaunches', async () => {
    const { checkForAppUpdates, installUpdate } = await load()
    const update = makeUpdate()
    check.mockResolvedValue(update)

    await checkForAppUpdates()
    await installUpdate()

    expect(update.downloadAndInstall).toHaveBeenCalledOnce()
    expect(relaunch).toHaveBeenCalledOnce()
  })

  it('forgets the offered update when dismissed', async () => {
    const { checkForAppUpdates, dismissUpdate, installUpdate, useUpdateStore } = await load()
    const update = makeUpdate()
    check.mockResolvedValue(update)

    await checkForAppUpdates()
    dismissUpdate()
    await installUpdate()

    expect(useUpdateStore.getState().pending).toBeNull()
    expect(update.downloadAndInstall).not.toHaveBeenCalled()
    expect(relaunch).not.toHaveBeenCalled()
  })
})

describe('releaseNotes', () => {
  it('turns a release-please body into plain sentences', async () => {
    const { releaseNotes } = await load()
    const body = [
      '## [0.1.18](https://github.com/bruno00o/gameroute/compare/v0.1.17...v0.1.18) (2026-10-08)',
      '',
      '### Features',
      '',
      '* **capture:** recognise riot game servers by operator and port ([5164640](https://github.com/bruno00o/gameroute/commit/516464036562641a0ab1d1c4ab0858c7f41061ee))',
      '',
      '### Bug Fixes',
      '',
      '* **i18n:** describe the [app](https://example.com)’s real outbound connections ([00596b6](https://github.com/bruno00o/gameroute/commit/00596b6))',
      '- merge short gaps within a match',
    ].join('\r\n')

    expect(releaseNotes(body)).toEqual([
      'Recognise riot game servers by operator and port',
      'Describe the app’s real outbound connections',
      'Merge short gaps within a match',
    ])
  })

  it('keeps plain lines when the body has no list', async () => {
    const { releaseNotes } = await load()

    expect(releaseNotes(undefined)).toEqual([])
    expect(releaseNotes('')).toEqual([])
    expect(releaseNotes('## 0.2.0\n\nBug fixes and improvements.')).toEqual([
      'Bug fixes and improvements.',
    ])
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedGame } from '@/types/backend'

const { check, ask, relaunch } = vi.hoisted(() => ({
  check: vi.fn(),
  ask: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({ check }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ ask }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }))
vi.mock('@/paraglide/messages', () => ({
  updater_title: () => 'Update available',
  updater_update_now: () => 'Update now',
  updater_later: () => 'Later',
  updater_match_warning: ({ game }: { game: string }) => `${game} is being monitored`,
}))

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
    version: '1.2.3',
    body: 'Release notes',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  }
}

async function load() {
  const updater = await import('./updater')
  const { useMonitoringStore } = await import('@/stores/monitoring-store')
  const { useTraceStore } = await import('@/stores/trace-store')
  return {
    ...updater,
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
  ask.mockReset().mockResolvedValue(false)
  relaunch.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('checkForAppUpdatesOnStartup', () => {
  it('prompts as soon as the grace period ends when no game is monitored', async () => {
    const { checkForAppUpdatesOnStartup, STARTUP_GRACE_MS } = await load()
    check.mockResolvedValue(makeUpdate())

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS - 1)
    expect(ask).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(
      'v1.2.3\n\nRelease notes',
      expect.objectContaining({
        title: 'Update available',
        kind: 'info',
        okLabel: 'Update now',
        cancelLabel: 'Later',
      })
    )
  })

  it('does not prompt while a game is monitored and prompts once it ends', async () => {
    const {
      checkForAppUpdatesOnStartup,
      startGame,
      endGame,
      STARTUP_GRACE_MS,
      POST_MATCH_SETTLE_MS,
    } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()

    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS * 10)
    expect(ask).not.toHaveBeenCalled()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS - 1)
    expect(ask).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(
      'v1.2.3\n\nRelease notes',
      expect.objectContaining({ kind: 'info' })
    )
  })

  it('defers the prompt when a game is detected during the grace period', async () => {
    const {
      checkForAppUpdatesOnStartup,
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
    expect(ask).not.toHaveBeenCalled()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('waits for the post-match traceroutes to finish', async () => {
    const {
      checkForAppUpdatesOnStartup,
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
    expect(ask).not.toHaveBeenCalled()

    finishTraces()
    await vi.advanceTimersByTimeAsync(0)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('prompts at the cap when a traceroute never finishes', async () => {
    const {
      checkForAppUpdatesOnStartup,
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
    expect(ask).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('keeps waiting when a new game starts during the post-match traceroutes', async () => {
    const {
      checkForAppUpdatesOnStartup,
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
    expect(ask).not.toHaveBeenCalled()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_SETTLE_MS)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('prompts at most once per run', async () => {
    const { checkForAppUpdatesOnStartup, startGame, endGame, STARTUP_GRACE_MS } = await load()
    check.mockResolvedValue(makeUpdate())

    checkForAppUpdatesOnStartup()
    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    expect(check).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledOnce()

    startGame()
    endGame()
    checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS * 10)
    expect(check).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledOnce()
  })

  it('skips the deferred prompt when the update was already offered from Settings', async () => {
    const {
      checkForAppUpdates,
      checkForAppUpdatesOnStartup,
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
    expect(ask).toHaveBeenCalledOnce()

    endGame()
    await vi.advanceTimersByTimeAsync(POST_MATCH_TRACE_CAP_MS)
    expect(ask).toHaveBeenCalledOnce()
  })

  it('does not prompt when no update is available', async () => {
    const { checkForAppUpdatesOnStartup, STARTUP_GRACE_MS } = await load()
    check.mockResolvedValue(null)

    await checkForAppUpdatesOnStartup()
    await vi.advanceTimersByTimeAsync(STARTUP_GRACE_MS)
    expect(ask).not.toHaveBeenCalled()
  })

  it('swallows update check errors', async () => {
    const { checkForAppUpdatesOnStartup } = await load()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    check.mockRejectedValue(new Error('offline'))

    await expect(checkForAppUpdatesOnStartup()).resolves.toBeUndefined()
    expect(ask).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('checkForAppUpdates', () => {
  it('prompts immediately when no game is monitored', async () => {
    const { checkForAppUpdates } = await load()
    check.mockResolvedValue(makeUpdate())

    await expect(checkForAppUpdates()).resolves.toBe(true)
    expect(ask).toHaveBeenCalledWith(
      'v1.2.3\n\nRelease notes',
      expect.objectContaining({ kind: 'info' })
    )
  })

  it('warns that installing stops the current match measurement', async () => {
    const { checkForAppUpdates, startGame } = await load()
    check.mockResolvedValue(makeUpdate())
    startGame()

    await checkForAppUpdates()
    expect(ask).toHaveBeenCalledWith(
      'Valorant is being monitored\n\nv1.2.3\n\nRelease notes',
      expect.objectContaining({ kind: 'warning' })
    )
  })

  it('installs and relaunches when the user accepts', async () => {
    const { checkForAppUpdates } = await load()
    const update = makeUpdate()
    check.mockResolvedValue(update)
    ask.mockResolvedValue(true)

    await checkForAppUpdates()
    expect(update.downloadAndInstall).toHaveBeenCalledOnce()
    expect(relaunch).toHaveBeenCalledOnce()
  })

  it('returns false without prompting when no update is available', async () => {
    const { checkForAppUpdates } = await load()
    check.mockResolvedValue(null)

    await expect(checkForAppUpdates()).resolves.toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })
})

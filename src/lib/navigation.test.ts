import { describe, expect, it } from 'vitest'

import type { LiveState } from '@/lib/live-state'
import { findNavItem, getNavigationGroups, isNavItemActive } from './navigation'

const keysOf = (state?: LiveState) =>
  getNavigationGroups(state).map(group => [group.key, group.items.map(item => item.key)])

describe('getNavigationGroups', () => {
  it('follows the v2 order with the analysis group between the main and bottom entries', () => {
    expect(keysOf()).toEqual([
      ['main', ['home', 'live', 'sessions', 'games']],
      ['analysis', ['route', 'history']],
      ['bottom', ['settings', 'help']],
    ])
  })

  it('labels only the analysis group', () => {
    expect(getNavigationGroups().map(group => group.label)).toEqual([
      undefined,
      'Analysis',
      undefined,
    ])
  })

  it('keeps each current screen under its new entry', () => {
    const routes = Object.fromEntries(
      getNavigationGroups()
        .flatMap(group => group.items)
        .map(item => [item.key, item.to])
    )

    expect(routes).toEqual({
      home: '/',
      live: '/trace',
      sessions: '/sessions',
      games: '/games',
      route: '/route',
      history: '/network',
      settings: '/settings',
      help: '/help',
    })
  })

  it('puts the live dot on the live entry only while a match is measured', () => {
    const dotted = (state: LiveState) =>
      getNavigationGroups(state)
        .flatMap(group => group.items)
        .filter(item => item.live)
        .map(item => item.key)

    expect(dotted('live')).toEqual(['live'])
    expect(dotted('measuring')).toEqual([])
    expect(dotted('idle')).toEqual([])
    expect(dotted('stale')).toEqual([])
  })
})

describe('findNavItem', () => {
  const groups = getNavigationGroups()
  const activeKey = (pathname: string) => findNavItem(groups, pathname)?.key

  it('matches home only on the root path', () => {
    expect(activeKey('/')).toBe('home')
    expect(activeKey('/sessions')).not.toBe('home')
  })

  it('keeps the parent entry active on nested screens', () => {
    expect(activeKey('/sessions')).toBe('sessions')
    expect(activeKey('/sessions/42')).toBe('sessions')
    expect(activeKey('/games/')).toBe('games')
  })

  it('maps the current screens to their v2 entries', () => {
    expect(activeKey('/trace')).toBe('live')
    expect(activeKey('/route')).toBe('route')
    expect(activeKey('/network')).toBe('history')
    expect(activeKey('/settings')).toBe('settings')
    expect(activeKey('/help')).toBe('help')
  })

  it('leaves screens outside the navigation without an active entry', () => {
    expect(activeKey('/welcome')).toBeUndefined()
    expect(activeKey('/sessionsx')).toBeUndefined()
  })
})

describe('isNavItemActive', () => {
  it('only matches whole path segments', () => {
    expect(isNavItemActive('/trace', '/trace/1')).toBe(true)
    expect(isNavItemActive('/trace', '/traces')).toBe(false)
    expect(isNavItemActive('/', '/help')).toBe(false)
  })
})

import type { RemixiconComponentType } from '@remixicon/react'
import {
  RiDashboardLine,
  RiFileTextLine,
  RiGamepadLine,
  RiHistoryLine,
  RiPulseLine,
  RiQuestionLine,
  RiRouteLine,
  RiSettings3Line,
  RiTimeLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'
import type { LiveState } from '@/lib/live-state'

export type NavKey =
  'home' | 'live' | 'sessions' | 'games' | 'route' | 'history' | 'reports' | 'settings' | 'help'

export type NavItem = {
  key: NavKey
  title: string
  to: string
  icon: RemixiconComponentType
  live?: boolean
}

export type NavGroup = {
  key: 'main' | 'analysis' | 'bottom'
  label?: string
  items: NavItem[]
}

export function getNavigationGroups(liveState: LiveState = 'idle'): NavGroup[] {
  return [
    {
      key: 'main',
      items: [
        { key: 'home', title: m.nav_home(), to: '/', icon: RiDashboardLine },
        {
          key: 'live',
          title: m.nav_live(),
          to: '/live',
          icon: RiPulseLine,
          live: liveState === 'live',
        },
        { key: 'sessions', title: m.nav_sessions(), to: '/sessions', icon: RiHistoryLine },
        { key: 'games', title: m.nav_games(), to: '/games', icon: RiGamepadLine },
      ],
    },
    {
      key: 'analysis',
      label: m.nav_analysis_label(),
      items: [
        { key: 'route', title: m.nav_route(), to: '/route', icon: RiRouteLine },
        { key: 'history', title: m.nav_history(), to: '/history', icon: RiTimeLine },
        { key: 'reports', title: m.nav_reports(), to: '/reports', icon: RiFileTextLine },
      ],
    },
    {
      key: 'bottom',
      items: [
        { key: 'settings', title: m.nav_settings(), to: '/settings', icon: RiSettings3Line },
        { key: 'help', title: m.nav_help(), to: '/help', icon: RiQuestionLine },
      ],
    },
  ]
}

export function isNavItemActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}

const NESTED_UNDER: Record<string, NavKey> = { '/trace': 'route' }

export function findNavItem(groups: NavGroup[], pathname: string): NavItem | undefined {
  const items = groups.flatMap(group => group.items)
  const direct = items.find(item => isNavItemActive(item.to, pathname))
  if (direct) return direct
  const parent = Object.entries(NESTED_UNDER).find(([to]) => isNavItemActive(to, pathname))
  return parent && items.find(item => item.key === parent[1])
}

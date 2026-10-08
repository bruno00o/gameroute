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
          to: '/trace',
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
        { key: 'history', title: m.nav_history(), to: '/network', icon: RiTimeLine },
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

export function findNavItem(groups: NavGroup[], pathname: string): NavItem | undefined {
  return groups.flatMap(group => group.items).find(item => isNavItemActive(item.to, pathname))
}

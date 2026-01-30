import type { RemixiconComponentType } from '@remixicon/react'
import {
  RiDashboardLine,
  RiGamepadLine,
  RiHistoryLine,
  RiLifebuoyLine,
  RiLightbulbLine,
  RiRouteLine,
  RiSettings3Line,
  RiWifiLine,
} from '@remixicon/react'

import * as m from '@/paraglide/messages'

export type NavItem = {
  title: string
  to: string
  icon: RemixiconComponentType
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export function getNavigationData() {
  const navMain: NavGroup = {
    label: m.nav_main_label(),
    items: [
      { title: m.nav_dashboard(), to: '/', icon: RiDashboardLine },
      { title: m.nav_sessions(), to: '/sessions', icon: RiHistoryLine },
      { title: m.nav_games(), to: '/games', icon: RiGamepadLine },
      { title: m.nav_trace(), to: '/trace', icon: RiRouteLine },
    ],
  }

  const navAnalytics: NavGroup = {
    label: m.nav_analytics_label(),
    items: [
      { title: m.nav_network(), to: '/network', icon: RiWifiLine },
      { title: m.nav_insights(), to: '/insights', icon: RiLightbulbLine },
    ],
  }

  const navSecondary: NavGroup = {
    label: m.nav_secondary_label(),
    items: [
      { title: m.nav_settings(), to: '/settings', icon: RiSettings3Line },
      { title: m.nav_help(), to: '/help', icon: RiLifebuoyLine },
    ],
  }

  return { navMain, navAnalytics, navSecondary }
}

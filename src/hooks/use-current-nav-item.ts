import { useLocation } from '@tanstack/react-router'

import { getNavigationData, type NavItem } from '@/lib/navigation'

export function useCurrentNavItem(): NavItem | undefined {
  const { pathname } = useLocation()
  const { navMain, navAnalytics, navSecondary } = getNavigationData()
  const allItems = [
    ...navMain.items,
    ...navAnalytics.items,
    ...navSecondary.items,
  ]

  // Exact match first (handles "/" correctly)
  const exact = allItems.find((item) => item.to === pathname)
  if (exact) return exact

  // Longest prefix match (e.g. "/sessions/123" -> Sessions)
  let best: NavItem | undefined
  let bestLen = 0
  for (const item of allItems) {
    if (
      item.to !== '/' &&
      pathname.startsWith(item.to) &&
      item.to.length > bestLen
    ) {
      best = item
      bestLen = item.to.length
    }
  }

  return best
}

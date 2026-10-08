import { useLocation } from '@tanstack/react-router'

import { findNavItem, getNavigationGroups, type NavItem } from '@/lib/navigation'

export function useCurrentNavItem(): NavItem | undefined {
  const { pathname } = useLocation()
  return findNavItem(getNavigationGroups(), pathname)
}

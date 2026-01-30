import { Link, useLocation } from '@tanstack/react-router'

import { useCurrentNavItem } from '@/hooks/use-current-nav-item'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'
import * as m from '@/paraglide/messages'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

export function Header() {
  const navItem = useCurrentNavItem()
  const { pathname } = useLocation()
  const segments = useBreadcrumbStore((s) => s.segments)
  const isNested = navItem && pathname !== navItem.to

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <Breadcrumb>
        <BreadcrumbList>
          {navItem ? (
            isNested ? (
              <>
                <BreadcrumbItem>
                  <BreadcrumbLink render={<Link to={navItem.to} />}>
                    {navItem.title}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {segments.length > 0 ? (
                  segments.map((segment, i) => {
                    const isLast = i === segments.length - 1
                    return (
                      <span key={i} className="contents">
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          {isLast || !segment.onClick ? (
                            <BreadcrumbPage>{segment.label}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink
                              className="cursor-pointer"
                              onClick={segment.onClick}
                            >
                              {segment.label}
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                      </span>
                    )
                  })
                ) : (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{m.breadcrumb_detail()}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage>{navItem.title}</BreadcrumbPage>
              </BreadcrumbItem>
            )
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>{m.app_name()}</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  )
}

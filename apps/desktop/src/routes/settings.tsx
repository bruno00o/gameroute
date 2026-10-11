import { useEffect } from 'react'
import { Link, Outlet, createFileRoute, useLocation } from '@tanstack/react-router'

import * as m from '@/paraglide/messages'
import { useBreadcrumbStore } from '@/stores/breadcrumb-store'

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
})

const sections = [
  { to: '/settings', label: m.settings_section_general },
  { to: '/settings/capture', label: m.settings_section_capture },
  { to: '/settings/alerts', label: m.settings_section_alerts },
  { to: '/settings/privacy', label: m.settings_section_privacy },
] as const

function SettingsLayout() {
  const { pathname } = useLocation()
  const setSegments = useBreadcrumbStore(s => s.setSegments)
  const current = sections.find(section => section.to !== '/settings' && section.to === pathname)

  useEffect(() => {
    if (!current) return
    setSegments([{ label: current.label() }])
    return () => setSegments([])
  }, [current, setSegments])

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-5 px-6 pt-5 pb-8">
        <h1 className="text-title">{m.page_settings_title()}</h1>
        <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
          <nav aria-label={m.settings_nav_label()} className="flex-[0_0_200px]">
            <ul className="flex flex-col gap-px">
              {sections.map(section => (
                <li key={section.to}>
                  <Link
                    to={section.to}
                    activeOptions={{ exact: true }}
                    className="text-ui text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background aria-[current=page]:bg-surface-raised aria-[current=page]:text-foreground flex min-h-8 items-center rounded-sm px-2.5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-2 aria-[current=page]:font-semibold aria-[current=page]:shadow-[inset_0_0_0_1px_var(--line)]"
                  >
                    {section.label()}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex max-w-[720px] min-w-0 flex-[1_1_520px] flex-col gap-8">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

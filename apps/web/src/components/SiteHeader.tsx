import { Link } from '@tanstack/react-router'
import { m } from '@/paraglide/messages'
import { Logo } from './Logo'

export function SiteHeader() {
  return (
    <header className="border-b bg-surface">
      <div className="gw-wrap flex min-h-[68px] flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3">
        <Link to="/" aria-label={m.nav_home()} className="flex items-center gap-2.5 no-underline">
          <Logo />
          <span className="text-[17px] leading-none font-bold tracking-[-0.01em] text-ink [font-stretch:112%]">
            GameRoute
          </span>
        </Link>
        <nav
          aria-label={m.nav_label()}
          className="gw-nav flex flex-wrap items-center gap-x-7 gap-y-2"
        >
          <Link to="/" activeOptions={{ exact: true }}>
            {m.nav_barometer()}
          </Link>
          <Link to="/methode">{m.nav_method()}</Link>
          <Link to="/telecharger" className="gr-btn gr-btn--primary">
            {m.nav_download()}
          </Link>
        </nav>
      </div>
    </header>
  )
}

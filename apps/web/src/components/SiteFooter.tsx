import { Link, useLocation } from '@tanstack/react-router'
import { LICENSE_URL, REPO_URL } from '@/lib/links'
import { m } from '@/paraglide/messages'
import { getLocale, type Locale, localizeHref } from '@/paraglide/runtime'

const LANGUAGES: { locale: Locale; name: string }[] = [
  { locale: 'fr', name: 'Français' },
  { locale: 'en', name: 'English' },
]

export function SiteFooter() {
  const { pathname } = useLocation()
  const current = getLocale()

  return (
    <footer className="gw-foot border-t bg-canvas">
      <div className="gw-wrap flex flex-wrap justify-between gap-x-12 gap-y-6 py-10">
        <div className="flex max-w-[400px] flex-col gap-2">
          <p className="m-0 text-[15px] leading-5 font-bold [font-stretch:112%]">GameRoute</p>
          <p className="gw-small">{m.footer_tagline()}</p>
          <p className="gw-small">
            <a href={LICENSE_URL}>{m.footer_license()}</a>
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <nav
            aria-label={m.footer_nav_label()}
            className="flex flex-wrap gap-x-7 gap-y-3 text-sm leading-5"
          >
            <Link to="/">{m.nav_barometer()}</Link>
            <Link to="/methode">{m.nav_method()}</Link>
            <Link to="/telecharger">{m.nav_download()}</Link>
            <Link to="/confidentialite">{m.footer_privacy()}</Link>
            <Link to="/mentions-legales">{m.footer_legal()}</Link>
            <a href={REPO_URL}>{m.footer_source()}</a>
          </nav>
          <p className="gw-small flex flex-wrap gap-x-3">
            <span>{m.footer_language()}</span>
            {LANGUAGES.map(({ locale, name }) =>
              locale === current ? (
                <span key={locale} lang={locale} aria-current="true" className="text-ink">
                  {name}
                </span>
              ) : (
                <a
                  key={locale}
                  lang={locale}
                  hrefLang={locale}
                  href={localizeHref(pathname, { locale })}
                >
                  {name}
                </a>
              )
            )}
          </p>
        </div>
      </div>
    </footer>
  )
}

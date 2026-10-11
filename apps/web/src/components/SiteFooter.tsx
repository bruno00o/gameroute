import { Link, useLocation } from '@tanstack/react-router'
import { LICENSE_URL, REPO_URL } from '@/lib/links'
import { m } from '@/paraglide/messages'
import { getLocale, type Locale, localizeHref } from '@/paraglide/runtime'
import { Container } from './Container'

const LANGUAGES: { locale: Locale; name: string }[] = [
  { locale: 'fr', name: 'Français' },
  { locale: 'en', name: 'English' },
  { locale: 'es', name: 'Español' },
]

const FOOT_LINK = 'text-muted-foreground no-underline hover:text-foreground hover:underline'

export function SiteFooter() {
  const { pathname } = useLocation()
  const current = getLocale()

  return (
    <footer className="border-t bg-background">
      <Container className="flex flex-wrap justify-between gap-x-12 gap-y-6 py-10">
        <div className="flex max-w-[400px] flex-col gap-2">
          <p className="text-[15px] leading-5 font-bold font-stretch-112%">GameRoute</p>
          <p className="text-subtle-foreground">{m.footer_tagline()}</p>
          <p className="text-subtle-foreground">
            <a href={LICENSE_URL} className={FOOT_LINK}>
              {m.footer_license()}
            </a>
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <nav
            aria-label={m.footer_nav_label()}
            className="flex flex-wrap gap-x-7 gap-y-3 text-[14px] leading-5"
          >
            <Link to="/" className={FOOT_LINK}>
              {m.nav_barometer()}
            </Link>
            <Link to="/method" className={FOOT_LINK}>
              {m.nav_method()}
            </Link>
            <Link to="/download" className={FOOT_LINK}>
              {m.nav_download()}
            </Link>
            <Link to="/privacy" className={FOOT_LINK}>
              {m.footer_privacy()}
            </Link>
            <Link to="/legal-notice" className={FOOT_LINK}>
              {m.footer_legal()}
            </Link>
            <a href={REPO_URL} className={FOOT_LINK}>
              {m.footer_source()}
            </a>
          </nav>
          <p className="flex flex-wrap gap-x-3 text-subtle-foreground">
            <span>{m.footer_language()}</span>
            {LANGUAGES.map(({ locale, name }) =>
              locale === current ? (
                <span key={locale} lang={locale} aria-current="true" className="text-foreground">
                  {name}
                </span>
              ) : (
                <a
                  key={locale}
                  lang={locale}
                  hrefLang={locale}
                  href={localizeHref(pathname, { locale })}
                  className={FOOT_LINK}
                >
                  {name}
                </a>
              )
            )}
          </p>
        </div>
      </Container>
    </footer>
  )
}

import { m } from '@/paraglide/messages'
import { baseLocale, getLocale, type Locale, locales, localizeHref } from '@/paraglide/runtime'
import { SITE_URL } from './links'

const OG_LOCALES: Record<Locale, string> = { fr: 'fr_FR', en: 'en_US', es: 'es_ES' }

interface OgImage {
  url: string
  alt: string
}

interface PageHead {
  title: string
  description?: string
  path?: string
  image?: OgImage
  noindex?: boolean
}

export function localizedUrl(path: string, locale: Locale = getLocale()) {
  return `${SITE_URL}${localizeHref(path, { locale })}`
}

export function langQuery(locale: Locale = getLocale()) {
  return locale === baseLocale ? '' : `?lang=${locale}`
}

function siteImage(): OgImage {
  return { url: `${SITE_URL}/api/og/site.png${langQuery()}`, alt: m.home_title() }
}

export function pageHead({ title, description, path, image = siteImage(), noindex }: PageHead) {
  const locale = getLocale()
  const url = path ? localizedUrl(path, locale) : undefined
  const meta = [
    { title },
    ...(description ? [{ name: 'description', content: description }] : []),
    ...(noindex ? [{ name: 'robots', content: 'noindex, nofollow' }] : []),
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'GameRoute' },
    { property: 'og:locale', content: OG_LOCALES[locale] },
    ...(url ? [{ property: 'og:url', content: url }] : []),
    { property: 'og:title', content: title },
    ...(description ? [{ property: 'og:description', content: description }] : []),
    { property: 'og:image', content: image.url },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: image.alt },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    ...(description ? [{ name: 'twitter:description', content: description }] : []),
    { name: 'twitter:image', content: image.url },
  ]
  const links =
    path && !noindex
      ? [
          { rel: 'canonical', href: url },
          ...locales.map(hrefLang => ({
            rel: 'alternate',
            hrefLang,
            href: localizedUrl(path, hrefLang),
          })),
          { rel: 'alternate', hrefLang: 'x-default', href: localizedUrl(path, baseLocale) },
        ]
      : []
  return { meta, links }
}

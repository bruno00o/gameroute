import { baseLocale, locales } from '@/paraglide/runtime'
import { localizedUrl } from './head'
import { SITE_URL } from './links'

export const INDEXED_PATHS = ['/', '/method', '/download'] as const

export function robotsTxt() {
  return [
    'User-agent: *',
    'Content-Signal: search=yes, ai-input=yes, ai-train=no',
    'Allow: /',
    'Allow: /api/og/',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    '',
  ].join('\n')
}

function alternates(path: string) {
  return [
    ...locales.map(
      locale =>
        `<xhtml:link rel="alternate" hreflang="${locale}" href="${localizedUrl(path, locale)}"/>`
    ),
    `<xhtml:link rel="alternate" hreflang="x-default" href="${localizedUrl(path, baseLocale)}"/>`,
  ]
}

export function sitemapXml() {
  const urls = INDEXED_PATHS.flatMap(path =>
    locales.map(locale =>
      [`<url><loc>${localizedUrl(path, locale)}</loc>`, ...alternates(path), '</url>'].join('')
    )
  )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

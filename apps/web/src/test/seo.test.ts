import { describe, expect, it } from 'vitest'
import { robotsTxt, sitemapXml } from '@/lib/seo'

describe('seo files', () => {
  it('keeps the API out of crawlers but lets preview cards through', () => {
    const robots = robotsTxt()
    expect(robots).toContain('Disallow: /api/')
    expect(robots).toContain('Allow: /api/og/')
    expect(robots).not.toContain('/r/')
    expect(robots).toContain('Sitemap: https://gameroute.app/sitemap.xml')
  })

  it('lists every indexed page in every language with its alternates', () => {
    const sitemap = sitemapXml()
    for (const loc of [
      'https://gameroute.app/',
      'https://gameroute.app/en/method',
      'https://gameroute.app/es/download',
    ]) {
      expect(sitemap).toContain(`<loc>${loc}</loc>`)
    }
    expect(sitemap).toContain('hreflang="x-default" href="https://gameroute.app/method"')
    expect(sitemap).not.toContain('/privacy')
    expect(sitemap.match(/<url>/g)).toHaveLength(9)
  })
})

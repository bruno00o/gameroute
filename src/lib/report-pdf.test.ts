// @vitest-environment node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Locale } from '@/paraglide/runtime'
import { gameMeasuredCase, lossyCase, regionContextCase, sources } from '@/test/report-fixtures'
import { reportDocument, type ReportOptions, type ReportSource } from '@/lib/report'
import { renderReportPdf, type ReportPdfFonts } from '@/lib/report-pdf'

const NOW = new Date(2026, 9, 8, 14, 32)
const PAGE = { width: 595.28, height: 841.89 }
const MARGIN = 42

const font = (path: string) => new Uint8Array(readFileSync(resolve('node_modules', path)))

let fonts: ReportPdfFonts

beforeAll(() => {
  fonts = {
    ui: font('@fontsource/archivo/files/archivo-latin-400-normal.woff'),
    uiSemibold: font('@fontsource/archivo/files/archivo-latin-600-normal.woff'),
    uiBold: font('@fontsource/archivo/files/archivo-latin-700-normal.woff'),
    mono: font('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'),
    monoMedium: font('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'),
    symbols: font('@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff'),
  }
})

function richSources(): ReportSource[] {
  const lossy = lossyCase()
  const game = gameMeasuredCase()
  const region = regionContextCase()
  return [
    ...sources(lossy.detail, lossy.matches, [1, 2, 3]),
    ...sources(game.detail, game.matches, [1]),
    ...sources(region.detail, region.matches, [2]),
  ]
}

const options = (locale: Locale, overrides: Partial<ReportOptions> = {}): ReportOptions => ({
  recipient: 'isp',
  route: true,
  hops: true,
  addresses: false,
  now: NOW,
  locale,
  ...overrides,
})

async function createPdf(
  list: ReportSource[],
  locale: Locale = 'fr',
  overrides: Partial<ReportOptions> = {}
) {
  const document = reportDocument(list, options(locale, overrides))
  const bytes = await renderReportPdf(document, fonts, { locale, now: NOW })
  return { document, bytes }
}

type TextItem = { str: string; x: number; y: number; width: number }

async function read(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const pages: { width: number; height: number; items: TextItem[] }[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number)
    const [, , width, height] = page.view
    const content = await page.getTextContent()
    const items = content.items.flatMap(item =>
      'str' in item && item.str.trim() !== ''
        ? [{ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width }]
        : []
    )
    pages.push({ width, height, items })
  }
  const info = (await pdf.getMetadata()).info as Record<string, unknown>
  return { pages, info }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()
const textOf = (pages: { items: TextItem[] }[]) =>
  flat(pages.map(page => page.items.map(item => item.str).join(' ')).join(' '))

describe('renderReportPdf', () => {
  it('writes an A4 PDF with embedded fonts and the document metadata', async () => {
    const { bytes, document } = await createPdf(richSources())
    const raw = Buffer.from(bytes).toString('latin1')

    expect(raw.startsWith('%PDF-')).toBe(true)
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(raw.match(/\/FontFile2/g)?.length).toBeGreaterThanOrEqual(5)
    expect(raw).toContain('/ToUnicode')

    const { pages, info } = await read(bytes)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    for (const page of pages) {
      expect(page.width).toBeCloseTo(PAGE.width, 1)
      expect(page.height).toBeCloseTo(PAGE.height, 1)
    }
    expect(info.Title).toBe(document.title)
    expect(info.Author).toBe('GameRoute')
  })

  it('numbers the pages and keeps every line inside the margins', async () => {
    const { bytes } = await createPdf(richSources())
    const { pages } = await read(bytes)

    pages.forEach((page, index) => {
      const labels = page.items.filter(item => item.str.startsWith('Page '))
      expect(labels).toHaveLength(1)
      expect(flat(labels[0].str)).toBe(`Page ${index + 1} sur ${pages.length}`)
      for (const item of page.items) {
        expect(item.x).toBeGreaterThanOrEqual(MARGIN - 1)
        expect(item.x + item.width).toBeLessThanOrEqual(PAGE.width - MARGIN + 1.5)
        expect(item.y).toBeGreaterThan(20)
        expect(item.y).toBeLessThan(PAGE.height - 20)
      }
    })
  })

  it.each<Locale>(['fr', 'en', 'es'])(
    'carries the wording of the text report, in %s',
    async locale => {
      const { bytes, document } = await createPdf(richSources(), locale)
      const { pages } = await read(bytes)
      const text = textOf(pages)

      const wording = [
        document.title,
        document.prepared,
        document.summary.heading,
        ...document.summary.lines,
        document.matchesHeading,
        ...document.matches.flatMap(match => [
          match.label,
          ...match.lines,
          ...(match.hops?.rows.flatMap(row => [row.zone, row.address, row.note]) ?? []),
          ...(match.route?.segments.flatMap(segment => [
            segment.zone,
            segment.name,
            segment.note,
          ]) ?? []),
        ]),
        document.limits.heading,
        ...document.limits.lines,
        document.context.heading,
        ...document.context.lines,
      ].filter((line): line is string => line != null && line !== '')

      const squash = (value: string) => value.replace(/\s+/g, '')
      const squashed = squash(text)
      for (const line of wording) {
        const plain = squash(line)
        const upper = squash(line.toLocaleUpperCase(locale))
        expect(squashed.includes(plain) || squashed.includes(upper), line).toBe(true)
      }
    }
  )

  it('keeps the symbols, accents and non-breaking spaces of the report', async () => {
    const { bytes } = await createPdf(richSources())
    const { pages } = await read(bytes)
    const text = pages.map(page => page.items.map(item => item.str).join(' ')).join(' ')

    expect(text).toContain('≥')
    expect(text).toContain('→')
    expect(text).toContain('é')
    expect(text).toContain('ms')
    expect(text).toMatch(/\d\sms/)
    expect(text).not.toContain('?')
  })

  it('draws the route and the hops only when they are asked for', async () => {
    const withAll = await read((await createPdf(richSources())).bytes)
    const without = await read(
      (await createPdf(richSources(), 'fr', { route: false, hops: false })).bytes
    )

    const full = textOf(withAll.pages)
    const short = textOf(without.pages)
    expect(full).toContain('Route par opérateur'.toLocaleUpperCase('fr'))
    expect(full).toContain('Détail des sauts'.toLocaleUpperCase('fr'))
    expect(short).not.toContain('Route par opérateur'.toLocaleUpperCase('fr'))
    expect(short).not.toContain('Détail des sauts'.toLocaleUpperCase('fr'))
    expect(without.pages.length).toBeLessThan(withAll.pages.length)
  })

  it('never prints the local addresses unless they are asked for', async () => {
    const hidden = textOf((await read((await createPdf(richSources())).bytes)).pages)
    const shown = textOf(
      (await read((await createPdf(richSources(), 'fr', { addresses: true })).bytes)).pages
    )

    expect(hidden).not.toContain('192.168.1.254')
    expect(shown).toContain('192.168.1.254')
    expect(hidden).toContain('87.245.233.46')
  })

  it('compares the matches in a table when there are several', async () => {
    const { bytes, document } = await createPdf(richSources())
    const { pages } = await read(bytes)
    const first = pages[0].items.map(item => item.str)

    for (const heading of ['PARTIE', 'HEURE', 'PING', 'PERTE', 'GIGUE', 'ÉTAT']) {
      expect(first).toContain(heading)
    }
    for (const match of document.matches) {
      expect(textOf(pages)).toContain(flat(match.label))
    }
  })

  it('wraps long names, hostnames and notes inside the margins', async () => {
    const lossy = lossyCase()
    const document = reportDocument(sources(lossy.detail, lossy.matches, [1]), options('fr'))
    const longName = 'Operateur-Tres-Long-Sans-Espace '.repeat(4).trim()
    const [match] = document.matches
    match.route!.segments.push({
      zone: 'Serveur du jeu',
      name: longName,
      asn: 64512,
      added: '+123 ms',
      addedMs: 123,
      hops: '12 sauts',
      status: 'degraded',
      note: 'Une note de perte beaucoup trop longue pour tenir sur une seule ligne',
    })
    match.hops!.rows[2].address = `${'a-very-long-hostname.'.repeat(8)}example.net (87.245.233.46)`
    const bytes = await renderReportPdf(document, fonts, { locale: 'fr', now: NOW })
    const { pages } = await read(bytes)

    for (const page of pages) {
      for (const item of page.items) {
        expect(item.x).toBeGreaterThanOrEqual(MARGIN - 1)
        expect(item.x + item.width).toBeLessThanOrEqual(PAGE.width - MARGIN + 1.5)
      }
    }
    expect(textOf(pages).replace(/\s/g, '')).toContain('Operateur-Tres-Long'.replace(/\s/g, ''))
  })

  it('stays on one page for a single match without route detail', async () => {
    const lossy = lossyCase()
    const { bytes } = await createPdf(sources(lossy.detail, lossy.matches, [1]), 'fr', {
      hops: false,
    })
    const { pages } = await read(bytes)

    expect(pages).toHaveLength(1)
    expect(textOf(pages)).not.toContain('PARTIE HEURE')
  })

  it('says so when no match is selected', async () => {
    const { bytes, document } = await createPdf([], 'en')
    const { pages } = await read(bytes)

    expect(pages).toHaveLength(1)
    expect(textOf(pages)).toContain(document.empty)
  })

  it('writes sample PDFs when asked to', async () => {
    const directory = process.env.REPORT_PDF_SAMPLE_DIR
    if (!directory) return
    mkdirSync(directory, { recursive: true })
    for (const locale of ['fr', 'en', 'es'] as const) {
      const { bytes } = await createPdf(richSources(), locale)
      writeFileSync(join(directory, `gameroute-report-${locale}.pdf`), bytes)
    }
    const lossy = lossyCase()
    const { bytes } = await createPdf(sources(lossy.detail, lossy.matches, [1]), 'fr')
    writeFileSync(join(directory, 'gameroute-report-single-fr.pdf'), bytes)
  })
})

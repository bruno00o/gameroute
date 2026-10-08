import PDFDocument from 'pdfkit'

import logoSvg from '@/assets/logo.svg?raw'
import * as m from '@/paraglide/messages'
import type { Locale } from '@/paraglide/runtime'
import type { Severity } from '@/types/backend'
import type {
  ReportDocument,
  ReportHopRow,
  ReportMatch,
  ReportRoute,
  ReportRouteSegment,
} from '@/lib/report'

export type ReportPdfFonts = {
  ui: Uint8Array
  uiSemibold: Uint8Array
  uiBold: Uint8Array
  mono: Uint8Array
  monoMedium: Uint8Array
  symbols: Uint8Array
}

export type ReportPdfOptions = {
  locale: Locale
  now?: Date
}

type FontKey = keyof ReportPdfFonts

type Style = {
  font: FontKey
  size: number
  color: string
  spacing?: number
  upper?: boolean
}

type Doc = InstanceType<typeof PDFDocument>

const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN_X = 42
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2
const HEADER_TOP = 32
const HEADER_RULE = 58
const CONTENT_TOP = 74
const CONTENT_BOTTOM = PAGE_HEIGHT - 44

const COLORS = {
  ink: '#151a21',
  muted: '#4d535b',
  subtle: '#666c74',
  line: '#dde0e4',
  lineStrong: '#81878d',
  sunken: '#eceff2',
  routeA: '#006ea4',
  routeB: '#4e92b8',
  white: '#ffffff',
}

const SEVERITY_COLORS: Record<Severity, string> = {
  ok: '#00774b',
  watch: '#786900',
  degraded: '#b84800',
  critical: '#a91228',
  unmeasured: '#666c74',
}

const TRAILING_SEVERITIES = new Set<Severity | null>(['watch', 'degraded', 'critical'])

const LOGO_PATH = /\sd="([^"]+)"/.exec(logoSvg)?.[1] ?? ''
const LOGO_WIDTH = 914
const LOGO_HEIGHT = 560

const NBSP = String.fromCharCode(0xa0)
const NARROW_NBSP = String.fromCharCode(0x202f)

const PRIMARY_RANGES: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x131, 0x131],
  [0x152, 0x153],
  [0x2bb, 0x2bc],
  [0x2c6, 0x2c6],
  [0x2da, 0x2da],
  [0x2dc, 0x2dc],
  [0x2000, 0x206f],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
]
const SYMBOL_CODES = new Set([0x2190, 0x2192, 0x2194, 0x2248, 0x2260, 0x2264, 0x2265, 0x221e])

const isSymbol = (char: string) => SYMBOL_CODES.has(char.codePointAt(0)!)
const isPrimary = (char: string) => {
  const code = char.codePointAt(0)!
  return PRIMARY_RANGES.some(([low, high]) => code >= low && code <= high)
}

const STYLES = {
  h1: { font: 'uiBold', size: 20, color: COLORS.ink },
  lead: { font: 'uiSemibold', size: 10.5, color: COLORS.ink },
  body: { font: 'ui', size: 9, color: COLORS.ink },
  bodyMuted: { font: 'ui', size: 9, color: COLORS.muted },
  small: { font: 'ui', size: 8, color: COLORS.muted },
  label: { font: 'uiSemibold', size: 8.5, color: COLORS.ink },
  overline: { font: 'uiSemibold', size: 7, color: COLORS.muted, spacing: 0.55, upper: true },
  data: { font: 'mono', size: 7.5, color: COLORS.ink },
  dataMuted: { font: 'mono', size: 7.5, color: COLORS.muted },
  dataStrong: { font: 'monoMedium', size: 8, color: COLORS.ink },
} satisfies Record<string, Style>

function normalize(text: string): string {
  let result = ''
  for (const char of text.replaceAll(NARROW_NBSP, NBSP)) {
    const code = char.codePointAt(0)!
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) result += ' '
    else if (isPrimary(char) || isSymbol(char)) result += char
    else result += '?'
  }
  return result
}

function runs(text: string): { text: string; symbols: boolean }[] {
  const result: { text: string; symbols: boolean }[] = []
  for (const char of text) {
    const symbols = isSymbol(char)
    const last = result[result.length - 1]
    if (last && last.symbols === symbols) last.text += char
    else result.push({ text: char, symbols })
  }
  return result
}

function labelSplit(line: string): { prefix: string; value: string } | null {
  const index = line.indexOf(':')
  if (index < 2 || index > 64 || line[index + 1] !== ' ') return null
  return { prefix: line.slice(0, index + 1), value: line.slice(index + 2) }
}

class Writer {
  readonly doc: Doc
  readonly locale: Locale
  y = CONTENT_TOP

  constructor(doc: Doc, locale: Locale) {
    this.doc = doc
    this.locale = locale
  }

  newPage() {
    this.doc.addPage()
    this.y = CONTENT_TOP
  }

  ensure(height: number) {
    if (this.y + height > CONTENT_BOTTOM) this.newPage()
  }

  width(text: string, style: Style): number {
    const content = normalize(style.upper ? text.toLocaleUpperCase(this.locale) : text)
    let total = 0
    for (const run of runs(content)) {
      this.doc.font(run.symbols ? 'symbols' : style.font).fontSize(style.size)
      total += this.doc.widthOfString(run.text)
    }
    return total + (style.spacing ?? 0) * [...content].length
  }

  text(text: string, x: number, baseline: number, style: Style, align: 'left' | 'right' = 'left') {
    const content = normalize(style.upper ? text.toLocaleUpperCase(this.locale) : text)
    let cursor = align === 'right' ? x - this.width(text, style) : x
    for (const run of runs(content)) {
      this.doc
        .font(run.symbols ? 'symbols' : style.font)
        .fontSize(style.size)
        .fillColor(style.color)
        .text(run.text, cursor, baseline, {
          lineBreak: false,
          baseline: 'alphabetic',
          characterSpacing: style.spacing ?? 0,
        })
      cursor += this.doc.widthOfString(run.text) + (style.spacing ?? 0) * [...run.text].length
    }
  }

  baseline(top: number, lineHeight: number, size: number): number {
    return top + lineHeight / 2 + size * 0.34
  }

  wrap(text: string, style: Style, maxWidth: number): string[] {
    const lines: string[] = []
    let current = ''
    const push = () => {
      lines.push(current)
      current = ''
    }
    for (const word of text.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (this.width(candidate, style) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) push()
      if (this.width(word, style) <= maxWidth) {
        current = word
        continue
      }
      for (const char of word) {
        if (current && this.width(current + char, style) > maxWidth) push()
        current += char
      }
    }
    if (current || lines.length === 0) push()
    return lines
  }

  paragraph(
    text: string,
    style: Style,
    options: { x?: number; width?: number; lineHeight?: number; gap?: number } = {}
  ) {
    const x = options.x ?? MARGIN_X
    const width = options.width ?? CONTENT_WIDTH
    const lineHeight = options.lineHeight ?? Math.round(style.size * 1.45 * 10) / 10
    for (const line of this.wrap(text, style, width)) {
      this.ensure(lineHeight)
      this.text(line, x, this.baseline(this.y, lineHeight, style.size), style)
      this.y += lineHeight
    }
    this.y += options.gap ?? 0
  }

  labelled(line: string, options: { x: number; width: number; lineHeight: number; size?: number }) {
    const { x, width, lineHeight } = options
    const size = options.size ?? 8.5
    const split = labelSplit(line)
    const labelStyle: Style = { font: 'uiSemibold', size, color: COLORS.muted }
    const valueStyle: Style = { font: 'ui', size, color: COLORS.ink }
    if (!split) {
      this.paragraph(line, valueStyle, { x, width, lineHeight })
      return
    }
    const { prefix } = split
    const indent = this.width(`${prefix} `, labelStyle)
    const tokens = split.value.split(' ')
    const lines: string[] = []
    let current = ''
    for (const token of tokens) {
      const limit = lines.length === 0 ? width - indent : width
      const candidate = current ? `${current} ${token}` : token
      if (current && this.width(candidate, valueStyle) > limit) {
        lines.push(current)
        current = token
      } else {
        current = candidate
      }
    }
    lines.push(current)
    lines.forEach((value, index) => {
      this.ensure(lineHeight)
      const baseline = this.baseline(this.y, lineHeight, size)
      if (index === 0) {
        this.text(prefix, x, baseline, labelStyle)
        this.text(value, x + indent, baseline, valueStyle)
      } else {
        this.text(value, x, baseline, valueStyle)
      }
      this.y += lineHeight
    })
  }

  rule(x1: number, x2: number, y: number, color: string, width = 0.5) {
    this.doc.lineWidth(width).strokeColor(color).moveTo(x1, y).lineTo(x2, y).stroke()
  }

  glyph(status: Severity, x: number, y: number, size: number) {
    const color = SEVERITY_COLORS[status]
    const { doc } = this
    doc
      .save()
      .translate(x, y)
      .scale(size / 10)
    if (status === 'ok') doc.circle(5, 5, 4.5).fill(color)
    else if (status === 'watch') {
      doc.circle(5, 5, 4).lineWidth(1.5).stroke(color)
      doc.path('M5 1 A4 4 0 0 0 5 9 Z').fill(color)
    } else if (status === 'degraded') doc.path('M5 0.6 L9.7 9.2 L0.3 9.2 Z').fill(color)
    else if (status === 'critical') doc.path('M5 0 L10 5 L5 10 L0 5 Z').fill(color)
    else doc.circle(5, 5, 3.9).lineWidth(1.5).dash(2.1, { space: 1.6 }).stroke(color).undash()
    doc.restore()
  }

  statusLabel(status: Severity): string {
    const tr = { locale: this.locale }
    const labels: Record<Severity, string> = {
      ok: m.status_ok({}, tr),
      watch: m.status_watch({}, tr),
      degraded: m.status_degraded({}, tr),
      critical: m.status_critical({}, tr),
      unmeasured: m.status_unmeasured({}, tr),
    }
    return labels[status]
  }

  status(status: Severity, x: number, centerY: number, align: 'left' | 'right' = 'left') {
    const style: Style = {
      font: 'uiSemibold',
      size: 8,
      color: status === 'unmeasured' ? COLORS.muted : COLORS.ink,
    }
    const label = this.statusLabel(status)
    const size = 8
    const labelWidth = this.width(label, style)
    const left = align === 'right' ? x - labelWidth - size - 4 : x
    this.glyph(status, left, centerY - size / 2, size)
    this.text(label, left + size + 4, this.baseline(centerY - 5, 10, 8), style)
  }

  heading(text: string) {
    this.ensure(34)
    this.y += 16
    this.text(text, MARGIN_X, this.baseline(this.y, 10, 7), STYLES.overline)
    this.y += 13
    this.rule(MARGIN_X, MARGIN_X + CONTENT_WIDTH, this.y, COLORS.lineStrong, 0.6)
    this.y += 8
  }
}

function drawTitle(w: Writer, document: ReportDocument) {
  w.paragraph(document.title, STYLES.h1, { lineHeight: 25, gap: 3 })
  w.paragraph(document.prepared, STYLES.bodyMuted, { lineHeight: 14 })
}

function drawSummary(w: Writer, document: ReportDocument) {
  w.heading(document.summary.heading)
  const [lead, ...rest] = document.summary.lines
  if (lead) w.paragraph(lead, STYLES.lead, { lineHeight: 15, gap: 5 })
  for (const line of rest) {
    w.ensure(13.5)
    w.doc.rect(MARGIN_X + 1, w.y + 5.5, 2.4, 2.4).fill(COLORS.lineStrong)
    w.paragraph(line, STYLES.body, {
      x: MARGIN_X + 11,
      width: CONTENT_WIDTH - 11,
      lineHeight: 13.5,
    })
    w.y += 2
  }
}

function overviewCells(match: ReportMatch) {
  const dash = '—'
  return {
    time: match.figures?.time ?? dash,
    ping: match.figures?.ping ?? dash,
    loss: match.figures?.loss ?? dash,
    jitter: match.figures?.jitter ?? dash,
  }
}

function drawOverview(w: Writer, matches: ReportMatch[]) {
  const tr = { locale: w.locale }
  const columns = {
    time: 82,
    ping: 66,
    loss: 46,
    jitter: 56,
    status: 92,
  }
  const right = MARGIN_X + CONTENT_WIDTH
  const x = {
    status: right - columns.status,
    jitter: right - columns.status - 6,
    loss: right - columns.status - columns.jitter - 6,
    ping: right - columns.status - columns.jitter - columns.loss - 6,
    time: right - columns.status - columns.jitter - columns.loss - columns.ping - 6,
  }
  const labelWidth = x.time - columns.time - MARGIN_X - 8

  const header = () => {
    const rowHeight = 18
    w.ensure(rowHeight + 22)
    const base = w.baseline(w.y, rowHeight, 7)
    w.text(m.report_pdf_col_match({}, tr), MARGIN_X, base, STYLES.overline)
    w.text(m.report_pdf_col_time({}, tr), x.time - columns.time, base, STYLES.overline)
    w.text(m.report_pdf_col_ping({}, tr), x.ping, base, STYLES.overline, 'right')
    w.text(m.report_pdf_col_loss({}, tr), x.loss, base, STYLES.overline, 'right')
    w.text(m.report_pdf_col_jitter({}, tr), x.jitter, base, STYLES.overline, 'right')
    w.text(m.report_pdf_col_status({}, tr), x.status + 8, base, STYLES.overline)
    w.y += rowHeight
    w.rule(MARGIN_X, right, w.y, COLORS.lineStrong, 0.6)
  }

  w.y += 6
  header()
  for (const match of matches) {
    const cells = overviewCells(match)
    const labelLines = w.wrap(match.label, STYLES.label, labelWidth)
    const rowHeight = Math.max(21, labelLines.length * 11 + 10)
    if (w.y + rowHeight > CONTENT_BOTTOM) {
      w.newPage()
      header()
    }
    const mid = w.y + rowHeight / 2
    const textTop = mid - (labelLines.length * 11) / 2
    labelLines.forEach((line, index) => {
      w.text(line, MARGIN_X, w.baseline(textTop + index * 11, 11, 8.5), STYLES.label)
    })
    const base = w.baseline(mid - 5.5, 11, 8)
    w.text(cells.time, x.time - columns.time, base, STYLES.data)
    w.text(cells.ping, x.ping, base, STYLES.dataStrong, 'right')
    w.text(cells.loss, x.loss, base, STYLES.data, 'right')
    w.text(cells.jitter, x.jitter, base, STYLES.data, 'right')
    w.status(match.status, x.status + 8, mid)
    w.y += rowHeight
    w.rule(MARGIN_X, right, w.y, COLORS.line)
  }
  w.y += 4
}

function segmentWidths(segments: ReportRouteSegment[], total: number): number[] {
  const MIN = 76
  const shares = segments.map(segment => Math.max(segment.addedMs, 4))
  const sum = shares.reduce((a, b) => a + b, 0)
  const widths = shares.map(share => Math.max(MIN, (share / sum) * total))
  const overflow = widths.reduce((a, b) => a + b, 0) - total
  if (overflow <= 0) return widths
  const flexible = widths.filter(width => width > MIN)
  const flexibleSum = flexible.reduce((a, b) => a + b - MIN, 0)
  return widths.map(width =>
    width > MIN ? width - ((width - MIN) / flexibleSum) * overflow : width
  )
}

function planRoute(w: Writer, route: ReportRoute, width: number) {
  const totalWidth = 80
  const destinationWidth = 88
  const gap = 10
  const segmentsWidth = width - totalWidth - destinationWidth - gap * 2
  const widths = segmentWidths(route.segments, segmentsWidth)

  const measured = route.segments.map((segment, index) => {
    const inner = widths[index] - 6
    const nameLines = segment.name ? w.wrap(segment.name, STYLES.label, inner - 12) : []
    const meta = [segment.asn != null ? `AS${segment.asn}` : null, segment.added, segment.hops]
      .filter(Boolean)
      .map(item => item!.replaceAll(' ', NBSP))
    const dataLines = w.wrap(meta.join(' '), STYLES.dataMuted, inner)
    const noteLines = segment.note ? w.wrap(segment.note, STYLES.small, inner) : []
    return { nameLines, dataLines, noteLines }
  })
  const bodyHeight = Math.max(
    ...measured.map(
      item =>
        item.nameLines.length * 11 +
        item.dataLines.length * 10 +
        (item.noteLines.length ? item.noteLines.length * 9.5 + 3 : 0)
    ),
    26
  )
  return {
    totalWidth,
    destinationWidth,
    gap,
    segmentsWidth,
    widths,
    measured,
    height: 12 + 12 + 6 + bodyHeight + 4,
  }
}

function drawRoute(w: Writer, route: ReportRoute, x0: number, width: number) {
  const { totalWidth, destinationWidth, gap, segmentsWidth, widths, measured, height } = planRoute(
    w,
    route,
    width
  )
  const startY = w.y
  w.ensure(height)
  const top = w.y

  let x = x0
  route.segments.forEach((segment, index) => {
    const segmentWidth = widths[index]
    const item = measured[index]
    w.text(segment.zone, x, w.baseline(top, 10, 7), STYLES.overline)

    const barY = top + 18
    const color = segment.status
      ? SEVERITY_COLORS[segment.status]
      : index % 2
        ? COLORS.routeB
        : COLORS.routeA
    w.doc.rect(x + 3, barY - 1.6, segmentWidth - 3, 3.2).fill(color)
    if (index === 0) {
      w.doc.circle(x + 3, barY, 3.6).fillAndStroke(COLORS.white, COLORS.ink)
    } else {
      w.doc.circle(x + 3, barY, 3.4).fill(COLORS.ink)
    }

    let cursor = top + 28
    for (const line of item.nameLines) {
      if (segment.status && line === item.nameLines[0]) w.glyph(segment.status, x, cursor + 1.5, 8)
      w.text(line, segment.status ? x + 12 : x, w.baseline(cursor, 11, 8.5), STYLES.label)
      cursor += 11
    }
    for (const line of item.dataLines) {
      w.text(line, x, w.baseline(cursor, 10, 7.5), STYLES.dataMuted)
      cursor += 10
    }
    if (item.noteLines.length) {
      cursor += 3
      const noteStyle: Style = { ...STYLES.small, color: SEVERITY_COLORS[segment.status ?? 'ok'] }
      for (const line of item.noteLines) {
        w.text(line, x, w.baseline(cursor, 9.5, 8), noteStyle)
        cursor += 9.5
      }
    }
    x += segmentWidth
  })

  const destinationX = x0 + segmentsWidth + gap
  const barY = top + 18
  const { destination } = route
  if (destination.silent) {
    w.doc
      .circle(destinationX + 5, barY, 4.3)
      .lineWidth(1.2)
      .dash(2, { space: 1.6 })
      .stroke(COLORS.subtle)
      .undash()
  } else {
    w.doc.circle(destinationX + 5, barY, 4.6).fill(COLORS.ink)
  }
  let cursor = top + 28
  for (const line of w.wrap(destination.name, STYLES.label, destinationWidth - 4)) {
    w.text(line, destinationX, w.baseline(cursor, 11, 8.5), STYLES.label)
    cursor += 11
  }
  if (destination.silent) {
    for (const line of w.wrap(destination.silentLabel, STYLES.small, destinationWidth - 4)) {
      w.text(line, destinationX, w.baseline(cursor, 9.5, 8), {
        ...STYLES.small,
        color: COLORS.subtle,
      })
      cursor += 9.5
    }
  }

  const totalX = x0 + width - totalWidth
  w.doc
    .lineWidth(0.5)
    .strokeColor(COLORS.line)
    .moveTo(totalX, top + 2)
    .lineTo(totalX, top + height - 4)
    .stroke()
  const readout: Style = { font: 'monoMedium', size: 12, color: COLORS.ink }
  w.text(route.total, x0 + width, w.baseline(top + 8, 16, 12), readout, 'right')
  let labelY = top + 28
  for (const line of w.wrap(route.totalLabel, STYLES.small, totalWidth - 10)) {
    w.text(
      line,
      x0 + width,
      w.baseline(labelY, 9.5, 8),
      { ...STYLES.small, color: COLORS.subtle },
      'right'
    )
    labelY += 9.5
  }

  w.y = Math.max(startY + height, w.y)
}

function drawHops(w: Writer, heading: string, rows: ReportHopRow[], x0: number, width: number) {
  const tr = { locale: w.locale }
  const railX = x0 + 30
  const textX = x0 + 42
  const lossRight = x0 + width - 66
  const pingRight = x0 + width
  const textWidth = lossRight - 48 - textX

  w.ensure(60)
  w.text(heading, x0, w.baseline(w.y, 10, 7), STYLES.overline)
  w.y += 12

  const header = () => {
    const rowHeight = 15
    const base = w.baseline(w.y, rowHeight, 7)
    w.text('#', x0 + 20, base, STYLES.overline, 'right')
    w.text(m.hop_col_router({}, tr), textX, base, STYLES.overline)
    w.text(m.report_pdf_col_loss({}, tr), lossRight, base, STYLES.overline, 'right')
    w.text(m.report_pdf_col_ping({}, tr), pingRight, base, STYLES.overline, 'right')
    w.y += rowHeight
    w.rule(x0, x0 + width, w.y, COLORS.lineStrong, 0.6)
  }
  header()

  const onset = rows.findIndex(row => !row.silent && TRAILING_SEVERITIES.has(row.status))
  const trail = onset >= 0 ? rows[onset].status : null

  rows.forEach((row, index) => {
    const addressLines = row.address ? w.wrap(row.address, STYLES.data, textWidth) : []
    const noteStyle: Style = {
      ...STYLES.small,
      color: row.status ? SEVERITY_COLORS[row.status] : COLORS.subtle,
    }
    const noteLines = row.note ? w.wrap(row.note, noteStyle, textWidth - 12) : []
    const lines = (row.zone ? 1 : 0) + addressLines.length + noteLines.length
    const rowHeight = Math.max(17, lines * 10 + 7)
    if (w.y + rowHeight > CONTENT_BOTTOM) {
      w.newPage()
      header()
    }
    const top = w.y
    const color = row.silent
      ? COLORS.subtle
      : trail && index >= onset
        ? SEVERITY_COLORS[trail]
        : COLORS.routeA

    if (row.silent) {
      w.doc
        .lineWidth(1.4)
        .dash(2.5, { space: 2 })
        .strokeColor(COLORS.subtle)
        .moveTo(railX, top)
        .lineTo(railX, top + rowHeight)
        .stroke()
        .undash()
    } else {
      w.doc.rect(railX - 0.7, top, 1.4, rowHeight).fill(color)
    }
    const nodeY = top + 8.5
    if (row.number == null) {
      w.doc
        .circle(railX, nodeY, 3.8)
        .lineWidth(1)
        .dash(1.8, { space: 1.4 })
        .fillAndStroke(COLORS.white, COLORS.subtle)
        .undash()
    } else if (row.silent) {
      w.doc
        .circle(railX, nodeY, 2.6)
        .lineWidth(1)
        .dash(1.6, { space: 1.2 })
        .fillAndStroke(COLORS.white, COLORS.subtle)
        .undash()
    } else {
      w.doc.circle(railX, nodeY, 2.6).lineWidth(1.2).fillAndStroke(COLORS.white, color)
    }

    let cursor = top + 3.5
    if (row.number != null) {
      w.text(String(row.number), x0 + 20, w.baseline(top + 3.5, 10, 7.5), STYLES.dataMuted, 'right')
    } else {
      w.text('→', x0 + 20, w.baseline(top + 3.5, 10, 7.5), STYLES.dataMuted, 'right')
    }
    if (row.zone) {
      w.text(row.zone, textX, w.baseline(cursor, 10, 8), { ...STYLES.label, size: 8 })
      cursor += 10
    }
    for (const line of addressLines) {
      w.text(line, textX, w.baseline(cursor, 10, 7.5), STYLES.data)
      cursor += 10
    }
    noteLines.forEach((line, noteIndex) => {
      if (noteIndex === 0) w.glyph(row.status ?? 'unmeasured', textX, cursor + 1, 7)
      w.text(line, textX + 11, w.baseline(cursor, 10, 8), noteStyle)
      cursor += 10
    })

    if (!row.silent) {
      const base = w.baseline(top + 3.5, 10, 7.5)
      if (row.status && row.loss) {
        w.glyph(row.status, lossRight - w.width(row.loss, STYLES.data) - 12, top + 4.2, 7.5)
        w.text(
          row.loss,
          lossRight,
          base,
          { ...STYLES.dataStrong, size: 7.5, color: SEVERITY_COLORS[row.status] },
          'right'
        )
      } else if (row.loss) {
        w.text(row.loss, lossRight, base, STYLES.dataMuted, 'right')
      }
      if (row.latency) w.text(row.latency, pingRight, base, STYLES.data, 'right')
    }
    w.y += rowHeight
    w.rule(textX - 4, x0 + width, w.y, COLORS.line, 0.4)
  })
  w.y += 4
}

function drawMatch(w: Writer, match: ReportMatch) {
  const tr = { locale: w.locale }
  const lineHeight = 12.5
  const factLines = match.lines.reduce(
    (count, line) =>
      count + w.wrap(line, { font: 'ui', size: 8.5, color: COLORS.ink }, CONTENT_WIDTH).length,
    0
  )
  const routeHeight = match.route ? 19 + planRoute(w, match.route, CONTENT_WIDTH).height : 0
  w.ensure(14 + 22 + factLines * lineHeight + routeHeight)
  w.y += 14
  w.text(match.label, MARGIN_X, w.baseline(w.y, 14, 10.5), { ...STYLES.lead, size: 10.5 })
  w.status(match.status, MARGIN_X + CONTENT_WIDTH, w.y + 7, 'right')
  w.y += 17
  w.rule(MARGIN_X, MARGIN_X + CONTENT_WIDTH, w.y, COLORS.line)
  w.y += 5
  for (const line of match.lines) {
    w.labelled(line, { x: MARGIN_X, width: CONTENT_WIDTH, lineHeight })
  }

  if (match.route) {
    w.y += 7
    w.text(m.route_label({}, tr), MARGIN_X, w.baseline(w.y, 10, 7), STYLES.overline)
    w.y += 12
    drawRoute(w, match.route, MARGIN_X, CONTENT_WIDTH)
  }
  if (match.hops) {
    w.y += 7
    drawHops(w, m.report_pdf_hops({}, tr), match.hops.rows, MARGIN_X, CONTENT_WIDTH)
  }
}

function drawNotes(w: Writer, heading: string, lines: string[]) {
  w.heading(heading)
  for (const line of lines) {
    w.paragraph(line, STYLES.small, { lineHeight: 11.5, gap: 4 })
  }
}

function drawPageFrame(w: Writer, page: number, total: number) {
  const { doc } = w
  const tile = 17
  doc.roundedRect(MARGIN_X, HEADER_TOP, tile, tile, 3.5).fill(COLORS.ink)
  const scale = (tile * 0.62) / LOGO_WIDTH
  doc
    .save()
    .translate(
      MARGIN_X + tile / 2 - (LOGO_WIDTH * scale) / 2,
      HEADER_TOP + tile / 2 - (LOGO_HEIGHT * scale) / 2
    )
    .scale(scale)
    .path(LOGO_PATH)
    .fill(COLORS.white, 'even-odd')
    .restore()
  w.text('GameRoute', MARGIN_X + tile + 7, w.baseline(HEADER_TOP + 1, 15, 10.5), {
    font: 'uiBold',
    size: 10.5,
    color: COLORS.ink,
  })
  w.text(
    m.report_pdf_page({ page: String(page), total: String(total) }, { locale: w.locale }),
    MARGIN_X + CONTENT_WIDTH,
    w.baseline(HEADER_TOP + 1, 15, 8),
    { font: 'mono', size: 8, color: COLORS.muted },
    'right'
  )
  w.rule(MARGIN_X, MARGIN_X + CONTENT_WIDTH, HEADER_RULE, COLORS.line)
}

export async function renderReportPdf(
  document: ReportDocument,
  fonts: ReportPdfFonts,
  options: ReportPdfOptions
): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: [PAGE_WIDTH, PAGE_HEIGHT],
    margin: 0,
    bufferPages: true,
    // The browser build of pdfkit has no standard font to fall back on
    font: '',
    lang: options.locale,
    displayTitle: true,
    info: {
      Title: document.title,
      Author: 'GameRoute',
      Creator: 'GameRoute',
      Subject: document.prepared,
      CreationDate: options.now ?? new Date(),
    },
  })
  const chunks: Uint8Array[] = []
  doc.on('data', (chunk: Uint8Array) => chunks.push(chunk))
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', reject)
  })

  for (const [key, data] of Object.entries(fonts)) {
    doc.registerFont(key, data as unknown as ArrayBuffer)
  }

  const w = new Writer(doc, options.locale)
  drawTitle(w, document)
  if (document.empty != null) {
    w.y += 14
    w.paragraph(document.empty, STYLES.body, { lineHeight: 14 })
  } else {
    drawSummary(w, document)
    if (document.matches.length > 1) drawOverview(w, document.matches)
    w.heading(document.matchesHeading)
    for (const match of document.matches) drawMatch(w, match)
    drawNotes(w, document.limits.heading, document.limits.lines)
    drawNotes(w, document.context.heading, document.context.lines)
  }

  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index++) {
    doc.switchToPage(range.start + index)
    drawPageFrame(w, index + 1, range.count)
  }
  doc.flushPages()
  doc.end()
  await finished

  const size = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

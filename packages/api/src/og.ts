import archivo400 from '@fontsource/archivo/files/archivo-latin-400-normal.woff?inline'
import archivo700 from '@fontsource/archivo/files/archivo-latin-700-normal.woff?inline'
import archivo800 from '@fontsource/archivo/files/archivo-latin-800-normal.woff?inline'
import type { RouteZone } from '@gameroute/shared'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import satori, { type Font, init as initLayout } from 'satori/standalone'

export type WasmSource = Awaited<Parameters<typeof initLayout>[0]>

export interface OgWasm {
  layout: WasmSource
  resvg: WasmSource
}

export type OgWasmLoader = () => Promise<OgWasm>

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

type Style = Record<string, string | number>

interface Node {
  type: string
  props: { style?: Style; children?: Child | Child[]; [key: string]: unknown }
}

type Child = Node | string

function h(type: string, style: Style, ...children: Child[]): Node {
  const props = { style: { display: 'flex', ...style }, children }
  return { type, props }
}

const COLORS = {
  canvas: '#f4f6f8',
  surface: '#ffffff',
  line: '#dde0e4',
  ink: '#151a21',
  muted: '#4d535b',
  subtle: '#666c74',
  brand: '#4a44c6',
  tint: '#f2f1fc',
} as const

const ZONE_COLORS: Record<RouteZone, string> = {
  home: '#6d767f',
  isp: '#57659d',
  transit: '#855e8d',
  service: '#34807a',
}

const MARK =
  'M457.701 560C379.799 560 309.328 528.175 258.577 476.816C131.581 504.912 34.6373 501.234 7.45892 459.884C-24.4198 411.383 48.2064 324.012 180.979 237.312C201.532 102.933 317.598 0 457.701 0C514.921 0 568.131 17.1689 612.462 46.6369C760.24 7.7675 876.372 7.24855 906.541 53.1488C938.054 101.095 867.445 187.023 737.564 272.738C737.626 275.152 737.657 277.572 737.657 280C737.657 434.64 612.316 560 457.701 560ZM177.746 280C177.746 331.786 191.803 380.288 216.307 421.899C145.265 432.463 94.011 426.894 78.0139 402.556C57.729 371.694 98.7295 317.639 178.487 259.481C177.996 266.257 177.746 273.099 177.746 280ZM225.61 280C225.61 329.193 240.791 374.826 266.706 412.433C337.681 396.606 421.802 368.266 507.898 329.317C575.517 298.727 635.845 265.442 685.017 232.737C670.951 164.18 626.895 106.621 567.225 74.4945C561.046 71.1677 554.699 68.1137 548.201 65.3483C520.392 53.5135 489.808 46.9677 457.701 46.9677C356.882 46.9677 271.077 111.512 239.039 201.692C236.551 208.696 234.387 215.855 232.565 223.151C228.022 241.346 225.61 260.39 225.61 280ZM314.04 463.036C353.556 494.347 403.455 513.032 457.701 513.032C578.041 513.032 676.988 421.075 688.645 303.328C643.595 330.068 593.201 356.338 538.79 380.953C460.982 416.152 384.195 443.791 314.04 463.036ZM726.926 202.96C798.432 148.38 834.138 98.3912 814.938 69.1793C795.566 39.7053 724.487 37.7568 629.177 58.6536C675.589 94.6729 710.369 144.972 726.926 202.96Z'

export interface OgHop {
  zone: RouteZone
  label: string
  detail: string
  silent?: boolean
}

export interface OgReport {
  label: string
  game: string
  verdict: string
  hops: OgHop[]
  culprit: RouteZone | null
  note?: string
}

export interface OgSite {
  label: string
  title: string
  lead: string
}

export const DEMO_REPORT: OgReport = {
  label: 'Exemple de rapport',
  game: 'League of Legends, serveur EUW',
  verdict: 'La latence grimpe dans le transit, pas chez vous ni chez votre FAI.',
  culprit: 'transit',
  hops: [
    { zone: 'home', label: 'Domicile', detail: '1 ms' },
    { zone: 'isp', label: 'FAI exemple', detail: '9 ms' },
    { zone: 'transit', label: 'Transit', detail: '41 ms' },
    { zone: 'service', label: 'Serveur du jeu', detail: '44 ms' },
  ],
}

function wordmark(): Node {
  return h(
    'div',
    { display: 'flex', alignItems: 'center', gap: 16 },
    h(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 56,
        height: 56,
        borderRadius: 8,
        backgroundColor: COLORS.ink,
      },
      {
        type: 'svg',
        props: {
          viewBox: '0 0 914 560',
          width: 40,
          height: 25,
          children: { type: 'path', props: { d: MARK, fill: COLORS.canvas, fillRule: 'evenodd' } },
        },
      }
    ),
    h('div', { fontSize: 34, fontWeight: 800, color: COLORS.ink, letterSpacing: -0.5 }, 'GameRoute')
  )
}

function hopCell(hop: OgHop, culprit: boolean): Node {
  const color = ZONE_COLORS[hop.zone]
  return h(
    'div',
    { display: 'flex', flexDirection: 'column', flex: 1, gap: 14 },
    h(
      'div',
      { display: 'flex', alignItems: 'center', height: 18 },
      hop.silent
        ? h('div', {
            flex: 1,
            height: 10,
            borderRadius: 9,
            border: `2px dashed ${COLORS.subtle}`,
          })
        : h('div', { flex: 1, height: culprit ? 18 : 10, borderRadius: 9, backgroundColor: color })
    ),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', gap: 4 },
      h(
        'div',
        { fontSize: 26, fontWeight: culprit ? 800 : 700, color: culprit ? color : COLORS.ink },
        hop.label
      ),
      h('div', { fontSize: 22, color: COLORS.muted }, hop.detail)
    )
  )
}

export function demoCard(): Node {
  return reportCard(DEMO_REPORT)
}

export function reportCard(report: OgReport): Node {
  return h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: 64,
      backgroundColor: COLORS.canvas,
      fontFamily: 'Archivo',
      color: COLORS.ink,
    },
    header(report.label),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', gap: 18 },
      h('div', { fontSize: 28, color: COLORS.subtle }, report.game),
      h(
        'div',
        {
          fontSize: report.verdict.length > 64 ? 46 : 54,
          fontWeight: 800,
          lineHeight: 1.12,
          letterSpacing: -1,
          maxWidth: 1040,
        },
        report.verdict
      )
    ),
    h(
      'div',
      {
        display: 'flex',
        gap: 20,
        padding: '28px 32px',
        boxSizing: 'border-box',
        borderRadius: 16,
        backgroundColor: COLORS.surface,
        border: `2px solid ${COLORS.line}`,
      },
      ...(report.hops.length > 0
        ? report.hops.map(hop => hopCell(hop, hop.zone === report.culprit))
        : [h('div', { fontSize: 26, color: COLORS.muted }, report.note ?? '')])
    )
  )
}

function header(label: string): Node {
  return h(
    'div',
    { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    wordmark(),
    h(
      'div',
      {
        display: 'flex',
        padding: '10px 20px',
        borderRadius: 999,
        backgroundColor: COLORS.tint,
        color: COLORS.brand,
        fontSize: 22,
        fontWeight: 700,
      },
      label
    )
  )
}

export function siteCard(site: OgSite): Node {
  return h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: 64,
      backgroundColor: COLORS.canvas,
      fontFamily: 'Archivo',
      color: COLORS.ink,
    },
    header(site.label),
    h(
      'div',
      { display: 'flex', flexDirection: 'column', gap: 22 },
      h(
        'div',
        { fontSize: 64, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.5, maxWidth: 1000 },
        site.title
      ),
      h('div', { fontSize: 30, color: COLORS.muted, maxWidth: 960 }, site.lead)
    ),
    h(
      'div',
      { display: 'flex', gap: 12 },
      ...Object.values(ZONE_COLORS).map(color =>
        h('div', { flex: 1, height: 14, borderRadius: 7, backgroundColor: color })
      )
    )
  )
}

function dataUrlBytes(url: string): ArrayBuffer {
  const binary = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

let fonts: Font[] | undefined

function loadFonts(): Font[] {
  fonts ??= [
    { name: 'Archivo', data: dataUrlBytes(archivo400), weight: 400, style: 'normal' },
    { name: 'Archivo', data: dataUrlBytes(archivo700), weight: 700, style: 'normal' },
    { name: 'Archivo', data: dataUrlBytes(archivo800), weight: 800, style: 'normal' },
  ]
  return fonts
}

let ready: Promise<void> | undefined

function prepare(loadWasm: OgWasmLoader): Promise<void> {
  ready ??= loadWasm()
    .then(({ layout, resvg }) => Promise.all([initLayout(layout), initWasm(resvg)]))
    .then(() => undefined)
    .catch(error => {
      ready = undefined
      throw error
    })
  return ready
}

export async function renderPng(
  card: Node,
  loadWasm: OgWasmLoader
): Promise<Uint8Array<ArrayBuffer>> {
  await prepare(loadWasm)
  const svg = await satori(card as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: loadFonts(),
  })
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } })
  const image = resvg.render()
  const png = image.asPng() as Uint8Array<ArrayBuffer>
  image.free()
  resvg.free()
  return png
}

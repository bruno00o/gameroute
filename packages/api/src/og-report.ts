import {
  REPORT_GAMES,
  ROUTE_ZONES,
  type ReportPayload,
  type ReportRecipient,
  type ReportRoute,
  type RouteZone,
} from '@gameroute/shared'
import type { OgHop, OgReport } from './og'

export const OG_LANGS = ['fr', 'en'] as const

export type OgLang = (typeof OG_LANGS)[number]

type Audience = 'player' | 'third'

interface Copy {
  label: string
  zones: Record<RouteZone, string>
  silent: string
  matches: (count: number) => string
  ok: (count: number) => string
  unmeasured: (count: number) => string
  unlocated: string
  located: Record<Audience, Record<RouteZone, string>>
  noRoute: string
}

const COPY: Record<OgLang, Copy> = {
  fr: {
    label: 'Rapport GameRoute',
    zones: { home: 'Domicile', isp: 'FAI', transit: 'Transit', service: 'Serveur du jeu' },
    silent: 'ne répond pas aux pings',
    matches: count => (count === 1 ? '1 partie' : `${count} parties`),
    ok: count => `Aucun problème mesuré sur ${count === 1 ? '1 partie' : `${count} parties`}.`,
    unmeasured: count =>
      count === 1
        ? 'Cette partie n’a pas pu être mesurée.'
        : 'Ces parties n’ont pas pu être mesurées.',
    unlocated: 'Un problème a été mesuré, sans zone identifiée.',
    located: {
      player: {
        home: 'Le problème se situe chez vous, avant votre FAI.',
        isp: 'Le problème se situe chez votre FAI, pas chez vous.',
        transit: 'Le problème se situe dans le transit, pas chez vous ni chez votre FAI.',
        service: 'Le problème se situe côté serveur du jeu, pas chez vous ni chez votre FAI.',
      },
      third: {
        home: 'Le problème se situe chez le joueur, avant son FAI.',
        isp: 'Le problème se situe chez le FAI du joueur, pas chez lui.',
        transit: 'Le problème se situe dans le transit, pas chez le joueur ni chez son FAI.',
        service: 'Le problème se situe côté serveur du jeu, pas chez le joueur ni chez son FAI.',
      },
    },
    noRoute: 'Pas de route mesurée dans ce rapport.',
  },
  en: {
    label: 'GameRoute report',
    zones: { home: 'Home', isp: 'ISP', transit: 'Transit', service: 'Game server' },
    silent: 'does not answer pings',
    matches: count => (count === 1 ? '1 match' : `${count} matches`),
    ok: count => `No problem measured over ${count === 1 ? '1 match' : `${count} matches`}.`,
    unmeasured: count =>
      count === 1 ? 'This match could not be measured.' : 'These matches could not be measured.',
    unlocated: 'A problem was measured, but not located.',
    located: {
      player: {
        home: 'The problem is at your home, before your ISP.',
        isp: 'The problem is in your ISP’s network, not at your home.',
        transit: 'The problem is in transit, not at your home or your ISP.',
        service: 'The problem is on the game server’s side, not at your home or your ISP.',
      },
      third: {
        home: 'The problem is at the player’s home, before their ISP.',
        isp: 'The problem is in the player’s ISP network, not at their home.',
        transit: 'The problem is in transit, not at the player’s home or their ISP.',
        service: 'The problem is on the game server’s side, not at the player’s home or their ISP.',
      },
    },
    noRoute: 'No route measured in this report.',
  },
}

const AUDIENCE: Record<ReportRecipient, Audience> = {
  forum: 'player',
  isp: 'third',
  publisher: 'third',
}

export function ogLang(value: string | undefined): OgLang {
  return value === 'en' ? 'en' : 'fr'
}

export function reportVerdict(payload: ReportPayload, lang: OgLang): string {
  const copy = COPY[lang]
  const { status, zone } = payload.verdict
  const count = payload.matches.length
  if (status === 'ok') return copy.ok(count)
  if (status === 'unmeasured') return copy.unmeasured(count)
  if (!zone) return copy.unlocated
  return copy.located[AUDIENCE[payload.recipient]][zone]
}

export function pickRoute(payload: ReportPayload): ReportRoute | null {
  const worst = payload.matches.find(
    match => match.route && match.status === payload.verdict.status
  )
  return (worst ?? payload.matches.find(match => match.route))?.route ?? null
}

function formatMs(value: number, lang: OgLang): string {
  const digits = Math.abs(value) < 10 ? 1 : 0
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(value)
  return `${value >= 0 ? '+' : ''}${number} ms`
}

function routeHops(route: ReportRoute, payload: ReportPayload, lang: OgLang): OgHop[] {
  const copy = COPY[lang]
  const hops: OgHop[] = []
  for (const zone of ROUTE_ZONES) {
    const segments = route.segments.filter(segment => segment.zone === zone)
    if (segments.length === 0) continue
    const names = [
      ...new Set(
        segments.map(segment => segment.name).filter((name): name is string => name != null)
      ),
    ]
    const label =
      zone === 'home'
        ? copy.zones.home
        : zone === 'isp'
          ? (payload.isp?.name ?? names[0] ?? copy.zones.isp)
          : zone === 'service'
            ? (route.destinationName ?? names[0] ?? copy.zones.service)
            : names.length === 1
              ? names[0]!
              : copy.zones.transit
    const addedMs = segments.reduce((sum, segment) => sum + segment.addedMs, 0)
    hops.push({ zone, label, detail: formatMs(addedMs, lang) })
  }
  if (route.destinationSilent && !hops.some(hop => hop.zone === 'service')) {
    hops.push({
      zone: 'service',
      label: route.destinationName ?? copy.zones.service,
      detail: copy.silent,
      silent: true,
    })
  }
  return hops
}

export function buildOgReport(payload: ReportPayload, lang: OgLang): OgReport {
  const copy = COPY[lang]
  const route = pickRoute(payload)
  const game = [REPORT_GAMES[payload.gameSlug], copy.matches(payload.matches.length)]
  if (payload.isp?.name) game.push(payload.isp.name)
  return {
    label: copy.label,
    game: game.join(', '),
    verdict: reportVerdict(payload, lang),
    culprit: ['ok', 'unmeasured'].includes(payload.verdict.status) ? null : payload.verdict.zone,
    hops: route ? routeHops(route, payload, lang) : [],
    note: copy.noRoute,
  }
}

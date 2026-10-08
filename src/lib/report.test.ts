import { describe, expect, it } from 'vitest'

import type { DbHop, SessionDetail, SessionMatch, TracerouteWithHops } from '@/types/backend'
import {
  at,
  measure,
  riotRoute,
  sessionDetail,
  sessionMatches,
  trace,
  RIOT,
} from '@/test/session-fixtures'
import {
  defaultReportSelection,
  reportCandidateKey,
  reportIspName,
  reportPublisherName,
  reportText as buildReport,
  type ReportCandidate,
  type ReportSource,
} from './report'

const NOW = new Date(2026, 9, 8, 14, 32)

function reportText(...args: Parameters<typeof buildReport>) {
  return buildReport(...args).replace(
    new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g'),
    ' '
  )
}

function sources(detail: SessionDetail, matches: SessionMatch[], numbers: number[]) {
  return numbers.map((number): ReportSource => ({
    detail,
    matches,
    match: matches.find(match => match.number === number)!,
  }))
}

function hop(overrides: Partial<DbHop> & Pick<DbHop, 'hopNumber'>): DbHop {
  return {
    id: overrides.hopNumber,
    tracerouteId: 21,
    ip: null,
    hostname: null,
    latencyMin: null,
    latencyAvg: null,
    latencyMax: null,
    packetLoss: 100,
    isProblemHop: false,
    source: null,
    lossStatus: null,
    ...overrides,
  }
}

function lossyTrace(): TracerouteWithHops {
  const route = riotRoute('critical')
  route.segments[2].lastHop = 6
  route.segments[2].hops = 4
  route.lastRespondingHop = 6
  route.totalMs = 38.4
  const lossy = { packetLoss: 33.3, lossStatus: 'critical' } as const
  return {
    ...trace(21, RIOT, at(15, 48), route),
    hops: [
      hop({ hopNumber: 1, ip: '192.168.1.254', latencyAvg: 0.6, latencyMax: 0.9, packetLoss: 0 }),
      hop({
        hopNumber: 2,
        ip: '77.136.10.6',
        hostname: 'bas1.paris.sfr.net',
        latencyAvg: 4.4,
        latencyMax: 5,
        packetLoss: 33.3,
      }),
      hop({
        hopNumber: 3,
        ip: '87.245.233.46',
        hostname: 'ae1-9.rt.th2.par.fr.retn.net',
        latencyAvg: 18.5,
        latencyMax: 19,
        ...lossy,
      }),
      hop({ hopNumber: 4, ip: '87.245.240.1', latencyAvg: 20.1, latencyMax: 21, ...lossy }),
      hop({ hopNumber: 5 }),
      hop({ hopNumber: 6, ip: '87.245.250.9', latencyAvg: 38.4, latencyMax: 40, ...lossy }),
    ],
    status: 'critical',
  }
}

function lossyCase() {
  const matches = sessionMatches()
  matches[0] = {
    ...matches[0],
    status: 'critical',
    trace: measure({
      tracerouteId: 21,
      startedAt: at(15, 48),
      offsetSecs: 180,
      measuredHop: 6,
      pingMs: 38.4,
      lossPct: 33.3,
      jitterMs: 6.8,
      usual: { medianMs: 17.6, sampleCount: 12 },
    }),
  }
  const detail = sessionDetail({
    traceroutes: [lossyTrace(), trace(11, RIOT, at(15, 45, 41), riotRoute())],
  })
  return { detail, matches }
}

const full = {
  recipient: 'isp',
  route: true,
  hops: true,
  addresses: false,
  now: NOW,
} as const

describe('reportText', () => {
  it('reports a measured match with its lower bound, its usual ping and the limits of the probe', () => {
    const detail = sessionDetail()
    const matches = sessionMatches()
    const text = reportText(sources(detail, matches, [2]), {
      ...full,
      hops: false,
      locale: 'en',
    })

    expect(text).toMatchInlineSnapshot(`
      "GameRoute connection report
      Prepared on October 8, 2026 at 14:32 · For SFR support

      Summary
      1 match: VALORANT · Sep 13
      No persistent loss up to the last responding router.

      Matches

      VALORANT · Sep 13 · match 2
        Time: 15:54 → 16:25 (31 min 12 s)
        Server: Riot Games (AS6507) · 162.249.72.5 · UDP 7323
        Ping: ≥ 18 ms · measured up to hop 3 (RETN)
        Persistent loss: none
        Jitter: 1.0 ms (spread of 3 probes)
        Trace: started during match 1
        Route: Your home +0.6 ms → Your ISP · SFR (AS15557) +3.0 ms → Transit · RETN (AS9002) +14 ms → Riot Games (doesn't answer pings) = ≥ 18 ms

      Measurement limits
      Each figure comes from one trace per server (3 probes per hop) started during the session, not from continuous measurement. Ping is the round trip to the last responding router; jitter is the spread of the 3 probes.
      “≥” marks a lower bound. The servers of Riot Games do not answer probes: the measurement stops at the last responding router (hop 3, RETN).
      A loss is counted only if every responding router, from one point of the route to the last, drops at least 10% of the probes. The loss of a single router is not counted.

      Local context
      Measured from the player's computer, on Windows, with GameRoute.
      Local connection type (Wi-Fi or cable): not measured.
      Local network addresses are not included in this report."
    `)
  })

  it('writes the same report in French', () => {
    const detail = sessionDetail()
    const matches = sessionMatches()
    const text = reportText(sources(detail, matches, [2]), {
      ...full,
      hops: false,
      locale: 'fr',
    })

    expect(text).toMatchInlineSnapshot(`
      "Rapport de connexion GameRoute
      Préparé le 8 octobre 2026 à 14:32 · À l'attention du support SFR

      Résumé
      1 partie : VALORANT · 13 sept.
      Aucune perte persistante jusqu'au dernier routeur qui répond.

      Parties

      VALORANT · 13 sept. · partie 2
        Heure : 15:54 → 16:25 (31 min 12 s)
        Serveur : Riot Games (AS6507) · 162.249.72.5 · UDP 7323
        Ping : ≥ 18 ms · mesuré jusqu'au saut 3 (RETN)
        Perte persistante : aucune
        Gigue : 1,0 ms (écart entre 3 sondes)
        Trace : lancée pendant la partie 1
        Route : Chez vous +0,6 ms → Votre FAI · SFR (AS15557) +3,0 ms → Transit · RETN (AS9002) +14 ms → Riot Games (ne répond pas aux pings) = ≥ 18 ms

      Limites de la mesure
      Chaque chiffre vient d'une trace par serveur (3 sondes par saut) lancée pendant la session, pas d'une mesure continue. Le ping est l'aller-retour jusqu'au dernier routeur qui répond ; la gigue est l'écart entre les 3 sondes.
      « ≥ » indique une valeur minimale. Les serveurs de Riot Games ne répondent pas aux sondes : la mesure s'arrête au dernier routeur qui répond (saut 3, RETN).
      Une perte n'est retenue que si chaque routeur qui répond, d'un point de la route jusqu'au dernier, perd au moins 10 % des sondes. La perte d'un routeur isolé n'est pas comptée.

      Contexte local
      Mesures faites depuis l'ordinateur du joueur, sous Windows, avec GameRoute.
      Type de connexion locale (Wi-Fi ou câble) : non mesuré.
      Les adresses du réseau local ne figurent pas dans ce rapport."
    `)
  })

  it('writes the same report in Spanish', () => {
    const detail = sessionDetail()
    const matches = sessionMatches()
    const text = reportText(sources(detail, matches, [2]), {
      ...full,
      hops: false,
      locale: 'es',
    })

    expect(text).toMatchInlineSnapshot(`
      "Informe de conexión de GameRoute
      Preparado el 8 de octubre de 2026 a las 14:32 · Para el soporte de SFR

      Resumen
      1 partida: VALORANT · 13 sept
      Ninguna pérdida persistente hasta el último router que responde.

      Partidas

      VALORANT · 13 sept · partida 2
        Hora: 15:54 → 16:25 (31 min 12 s)
        Servidor: Riot Games (AS6507) · 162.249.72.5 · UDP 7323
        Ping: ≥ 18 ms · medido hasta el salto 3 (RETN)
        Pérdida persistente: ninguna
        Jitter: 1,0 ms (diferencia entre 3 sondeos)
        Traza: iniciada durante la partida 1
        Ruta: Tu casa +0,6 ms → Tu proveedor · SFR (AS15557) +3,0 ms → Tránsito · RETN (AS9002) +14 ms → Riot Games (no responde a los pings) = ≥ 18 ms

      Límites de la medición
      Cada cifra viene de una traza por servidor (3 sondeos por salto) lanzada durante la sesión, no de una medición continua. El ping es la ida y vuelta hasta el último router que responde; el jitter es la diferencia entre los 3 sondeos.
      «≥» indica un valor mínimo. Los servidores de Riot Games no responden a los sondeos: la medición se detiene en el último router que responde (salto 3, RETN).
      Una pérdida solo se cuenta si cada router que responde, desde un punto de la ruta hasta el último, pierde al menos 10 % de los sondeos. La pérdida de un router aislado no se cuenta.

      Contexto local
      Medido desde el ordenador del jugador, en Windows, con GameRoute.
      Tipo de conexión local (Wi-Fi o cable): no medido.
      Las direcciones de la red local no figuran en este informe."
    `)
  })

  it('names the operator where a loss persists to the last responding router', () => {
    const { detail, matches } = lossyCase()
    const text = reportText(sources(detail, matches, [1, 2]), { ...full, locale: 'en' })

    expect(text).toMatchInlineSnapshot(`
      "GameRoute connection report
      Prepared on October 8, 2026 at 14:32 · For SFR support

      Summary
      2 matches: VALORANT · Sep 13
      VALORANT · Sep 13 · match 1: persistent loss of 33% up to the last responding router, from hop 3 (RETN), after SFR.
      No persistent loss on the other measured matches.
      Ping: ≥ 18 ms to ≥ 38 ms.

      Matches

      VALORANT · Sep 13 · match 1
        Time: 15:45 → 15:51 (6 min 36 s)
        Server: Riot Games (AS6507) · 162.249.72.5 · UDP 7284
        Ping: ≥ 38 ms · measured up to hop 6 (RETN) · usual ≥ 18 ms (median of 12 measurements)
        Persistent loss: 33%, from hop 3 (RETN), after SFR
        Jitter: 6.8 ms (spread of 3 probes)
        Trace: started 3:00 into the match
        Route: Your home +0.6 ms → Your ISP · SFR (AS15557) +3.0 ms → Transit · RETN (AS9002) +14 ms → Riot Games (doesn't answer pings) = ≥ 38 ms
        Hops:
          1 · Your home · 0.6 ms
          2 · SFR · bas1.paris.sfr.net (77.136.10.6) · 4.4 ms · Ignores some pings · normal
          3 · RETN · ae1-9.rt.th2.par.fr.retn.net (87.245.233.46) · 18.5 ms · loss 33% (persistent)
          4 · RETN · 87.245.240.1 · 20.1 ms · loss 33% (persistent)
          5 · RETN · This router doesn't answer pings · normal
          6 · RETN · 87.245.250.9 · 38.4 ms · loss 33% (persistent)
          Game server · 162.249.72.5 · This router doesn't answer pings · normal

      VALORANT · Sep 13 · match 2
        Time: 15:54 → 16:25 (31 min 12 s)
        Server: Riot Games (AS6507) · 162.249.72.5 · UDP 7323
        Ping: ≥ 18 ms · measured up to hop 3 (RETN)
        Persistent loss: none
        Jitter: 1.0 ms (spread of 3 probes)
        Trace: started during match 1
        Route: Your home +0.6 ms → Your ISP · SFR (AS15557) +3.0 ms → Transit · RETN (AS9002) +14 ms → Riot Games (doesn't answer pings) = ≥ 18 ms
        Hops:
          1 · Your home · 0.6 ms
          2 · SFR · 77.136.10.6 · 3.6 ms
          3 · RETN · 87.245.233.46 · 17.6 ms
          4 · RETN · This router doesn't answer pings · normal
          Game server · 162.249.72.5 · This router doesn't answer pings · normal

      Measurement limits
      Each figure comes from one trace per server (3 probes per hop) started during the session, not from continuous measurement. Ping is the round trip to the last responding router; jitter is the spread of the 3 probes.
      “≥” marks a lower bound. The servers of Riot Games do not answer probes: the measurement stops at the last responding router (hop 6, RETN; hop 3, RETN).
      A router that does not answer pings, or ignores some of them, is common: these hops are marked “normal” and do not count as loss.
      A loss is counted only if every responding router, from one point of the route to the last, drops at least 10% of the probes. The loss of a single router is not counted.

      Local context
      Measured from the player's computer, on Windows, with GameRoute.
      Local connection type (Wi-Fi or cable): not measured.
      Local network addresses are not included in this report."
    `)
  })

  it('names the operator where a loss persists, in French', () => {
    const { detail, matches } = lossyCase()
    const text = reportText(sources(detail, matches, [1, 2]), { ...full, locale: 'fr' })

    expect(text).toMatchInlineSnapshot(`
      "Rapport de connexion GameRoute
      Préparé le 8 octobre 2026 à 14:32 · À l'attention du support SFR

      Résumé
      2 parties : VALORANT · 13 sept.
      VALORANT · 13 sept. · partie 1 : perte persistante de 33 % jusqu'au dernier routeur qui répond, à partir du saut 3 (RETN), après SFR.
      Aucune perte persistante sur les autres parties mesurées.
      Ping : de ≥ 18 ms à ≥ 38 ms.

      Parties

      VALORANT · 13 sept. · partie 1
        Heure : 15:45 → 15:51 (6 min 36 s)
        Serveur : Riot Games (AS6507) · 162.249.72.5 · UDP 7284
        Ping : ≥ 38 ms · mesuré jusqu'au saut 6 (RETN) · habituel ≥ 18 ms (médiane de 12 mesures)
        Perte persistante : 33 %, à partir du saut 3 (RETN), après SFR
        Gigue : 6,8 ms (écart entre 3 sondes)
        Trace : lancée 3:00 après le début de la partie
        Route : Chez vous +0,6 ms → Votre FAI · SFR (AS15557) +3,0 ms → Transit · RETN (AS9002) +14 ms → Riot Games (ne répond pas aux pings) = ≥ 38 ms
        Sauts :
          1 · Chez vous · 0,6 ms
          2 · SFR · bas1.paris.sfr.net (77.136.10.6) · 4,4 ms · Ignore une partie des pings · normal
          3 · RETN · ae1-9.rt.th2.par.fr.retn.net (87.245.233.46) · 18,5 ms · perte 33 % (persistante)
          4 · RETN · 87.245.240.1 · 20,1 ms · perte 33 % (persistante)
          5 · RETN · Ce routeur ne répond pas aux pings · normal
          6 · RETN · 87.245.250.9 · 38,4 ms · perte 33 % (persistante)
          Serveur du jeu · 162.249.72.5 · Ce routeur ne répond pas aux pings · normal

      VALORANT · 13 sept. · partie 2
        Heure : 15:54 → 16:25 (31 min 12 s)
        Serveur : Riot Games (AS6507) · 162.249.72.5 · UDP 7323
        Ping : ≥ 18 ms · mesuré jusqu'au saut 3 (RETN)
        Perte persistante : aucune
        Gigue : 1,0 ms (écart entre 3 sondes)
        Trace : lancée pendant la partie 1
        Route : Chez vous +0,6 ms → Votre FAI · SFR (AS15557) +3,0 ms → Transit · RETN (AS9002) +14 ms → Riot Games (ne répond pas aux pings) = ≥ 18 ms
        Sauts :
          1 · Chez vous · 0,6 ms
          2 · SFR · 77.136.10.6 · 3,6 ms
          3 · RETN · 87.245.233.46 · 17,6 ms
          4 · RETN · Ce routeur ne répond pas aux pings · normal
          Serveur du jeu · 162.249.72.5 · Ce routeur ne répond pas aux pings · normal

      Limites de la mesure
      Chaque chiffre vient d'une trace par serveur (3 sondes par saut) lancée pendant la session, pas d'une mesure continue. Le ping est l'aller-retour jusqu'au dernier routeur qui répond ; la gigue est l'écart entre les 3 sondes.
      « ≥ » indique une valeur minimale. Les serveurs de Riot Games ne répondent pas aux sondes : la mesure s'arrête au dernier routeur qui répond (saut 6, RETN; saut 3, RETN).
      Un routeur qui ne répond pas aux pings, ou qui en ignore une partie, est courant : ces sauts sont marqués « normal » et ne comptent pas comme une perte.
      Une perte n'est retenue que si chaque routeur qui répond, d'un point de la route jusqu'au dernier, perd au moins 10 % des sondes. La perte d'un routeur isolé n'est pas comptée.

      Contexte local
      Mesures faites depuis l'ordinateur du joueur, sous Windows, avec GameRoute.
      Type de connexion locale (Wi-Fi ou câble) : non mesuré.
      Les adresses du réseau local ne figurent pas dans ce rapport."
    `)
  })

  it('names the operator where a loss persists, in Spanish', () => {
    const { detail, matches } = lossyCase()
    const text = reportText(sources(detail, matches, [1, 2]), { ...full, locale: 'es' })

    expect(text).toMatchInlineSnapshot(`
      "Informe de conexión de GameRoute
      Preparado el 8 de octubre de 2026 a las 14:32 · Para el soporte de SFR

      Resumen
      2 partidas: VALORANT · 13 sept
      VALORANT · 13 sept · partida 1: pérdida persistente de 33 % hasta el último router que responde, a partir del salto 3 (RETN), después de SFR.
      Ninguna pérdida persistente en las demás partidas medidas.
      Ping: de ≥ 18 ms a ≥ 38 ms.

      Partidas

      VALORANT · 13 sept · partida 1
        Hora: 15:45 → 15:51 (6 min 36 s)
        Servidor: Riot Games (AS6507) · 162.249.72.5 · UDP 7284
        Ping: ≥ 38 ms · medido hasta el salto 6 (RETN) · habitual ≥ 18 ms (mediana de 12 mediciones)
        Pérdida persistente: 33 %, a partir del salto 3 (RETN), después de SFR
        Jitter: 6,8 ms (diferencia entre 3 sondeos)
        Traza: iniciada 3:00 después del comienzo de la partida
        Ruta: Tu casa +0,6 ms → Tu proveedor · SFR (AS15557) +3,0 ms → Tránsito · RETN (AS9002) +14 ms → Riot Games (no responde a los pings) = ≥ 38 ms
        Saltos:
          1 · Tu casa · 0,6 ms
          2 · SFR · bas1.paris.sfr.net (77.136.10.6) · 4,4 ms · Ignora parte de los pings · normal
          3 · RETN · ae1-9.rt.th2.par.fr.retn.net (87.245.233.46) · 18,5 ms · pérdida 33 % (persistente)
          4 · RETN · 87.245.240.1 · 20,1 ms · pérdida 33 % (persistente)
          5 · RETN · Este router no responde a los pings · normal
          6 · RETN · 87.245.250.9 · 38,4 ms · pérdida 33 % (persistente)
          Servidor del juego · 162.249.72.5 · Este router no responde a los pings · normal

      VALORANT · 13 sept · partida 2
        Hora: 15:54 → 16:25 (31 min 12 s)
        Servidor: Riot Games (AS6507) · 162.249.72.5 · UDP 7323
        Ping: ≥ 18 ms · medido hasta el salto 3 (RETN)
        Pérdida persistente: ninguna
        Jitter: 1,0 ms (diferencia entre 3 sondeos)
        Traza: iniciada durante la partida 1
        Ruta: Tu casa +0,6 ms → Tu proveedor · SFR (AS15557) +3,0 ms → Tránsito · RETN (AS9002) +14 ms → Riot Games (no responde a los pings) = ≥ 18 ms
        Saltos:
          1 · Tu casa · 0,6 ms
          2 · SFR · 77.136.10.6 · 3,6 ms
          3 · RETN · 87.245.233.46 · 17,6 ms
          4 · RETN · Este router no responde a los pings · normal
          Servidor del juego · 162.249.72.5 · Este router no responde a los pings · normal

      Límites de la medición
      Cada cifra viene de una traza por servidor (3 sondeos por salto) lanzada durante la sesión, no de una medición continua. El ping es la ida y vuelta hasta el último router que responde; el jitter es la diferencia entre los 3 sondeos.
      «≥» indica un valor mínimo. Los servidores de Riot Games no responden a los sondeos: la medición se detiene en el último router que responde (salto 6, RETN; salto 3, RETN).
      Es habitual que un router no responda a los pings, o ignore parte de ellos: esos saltos se marcan «normal» y no cuentan como pérdida.
      Una pérdida solo se cuenta si cada router que responde, desde un punto de la ruta hasta el último, pierde al menos 10 % de los sondeos. La pérdida de un router aislado no se cuenta.

      Contexto local
      Medido desde el ordenador del jugador, en Windows, con GameRoute.
      Tipo de conexión local (Wi-Fi o cable): no medido.
      Las direcciones de la red local no figuran en este informe."
    `)
  })

  it('says so when a match has no measurement', () => {
    const detail = sessionDetail()
    const matches = sessionMatches()
    const text = reportText(sources(detail, matches, [3]), {
      ...full,
      recipient: 'forum',
      locale: 'en',
    })

    expect(text).toMatchInlineSnapshot(`
      "GameRoute connection report
      Prepared on October 8, 2026 at 14:32 · For a forum or a Discord server

      Summary
      1 match: VALORANT · Sep 13
      1 match without measurement: no trace completed.

      Matches

      VALORANT · Sep 13 · match 3
        Time: 16:27 → 17:09 (42 min 36 s)
        Server: Riot Games (AS6507) · 185.40.64.1 · UDP 7220
        Measurement: no trace completed for this server.

      Measurement limits
      Each figure comes from one trace per server (3 probes per hop) started during the session, not from continuous measurement. Ping is the round trip to the last responding router; jitter is the spread of the 3 probes.
      A loss is counted only if every responding router, from one point of the route to the last, drops at least 10% of the probes. The loss of a single router is not counted.

      Local context
      Measured from the player's computer, on Windows, with GameRoute.
      Local connection type (Wi-Fi or cable): not measured.
      Local network addresses are not included in this report."
    `)
  })

  it('says so when a match has no measurement, in French', () => {
    const detail = sessionDetail()
    const matches = sessionMatches()
    const text = reportText(sources(detail, matches, [3]), {
      ...full,
      recipient: 'forum',
      locale: 'fr',
    })

    expect(text).toMatchInlineSnapshot(`
      "Rapport de connexion GameRoute
      Préparé le 8 octobre 2026 à 14:32 · Pour un forum ou un serveur Discord

      Résumé
      1 partie : VALORANT · 13 sept.
      1 partie sans mesure : aucune trace n'a abouti.

      Parties

      VALORANT · 13 sept. · partie 3
        Heure : 16:27 → 17:09 (42 min 36 s)
        Serveur : Riot Games (AS6507) · 185.40.64.1 · UDP 7220
        Mesure : aucune trace n'a abouti pour ce serveur.

      Limites de la mesure
      Chaque chiffre vient d'une trace par serveur (3 sondes par saut) lancée pendant la session, pas d'une mesure continue. Le ping est l'aller-retour jusqu'au dernier routeur qui répond ; la gigue est l'écart entre les 3 sondes.
      Une perte n'est retenue que si chaque routeur qui répond, d'un point de la route jusqu'au dernier, perd au moins 10 % des sondes. La perte d'un routeur isolé n'est pas comptée.

      Contexte local
      Mesures faites depuis l'ordinateur du joueur, sous Windows, avec GameRoute.
      Type de connexion locale (Wi-Fi ou câble) : non mesuré.
      Les adresses du réseau local ne figurent pas dans ce rapport."
    `)
  })

  it('says so when a match has no measurement, in Spanish', () => {
    const detail = sessionDetail()
    const matches = sessionMatches()
    const text = reportText(sources(detail, matches, [3]), {
      ...full,
      recipient: 'forum',
      locale: 'es',
    })

    expect(text).toMatchInlineSnapshot(`
      "Informe de conexión de GameRoute
      Preparado el 8 de octubre de 2026 a las 14:32 · Para un foro o un servidor de Discord

      Resumen
      1 partida: VALORANT · 13 sept
      1 partida sin medición: ninguna traza se completó.

      Partidas

      VALORANT · 13 sept · partida 3
        Hora: 16:27 → 17:09 (42 min 36 s)
        Servidor: Riot Games (AS6507) · 185.40.64.1 · UDP 7220
        Medición: ninguna traza se completó para este servidor.

      Límites de la medición
      Cada cifra viene de una traza por servidor (3 sondeos por salto) lanzada durante la sesión, no de una medición continua. El ping es la ida y vuelta hasta el último router que responde; el jitter es la diferencia entre los 3 sondeos.
      Una pérdida solo se cuenta si cada router que responde, desde un punto de la ruta hasta el último, pierde al menos 10 % de los sondeos. La pérdida de un router aislado no se cuenta.

      Contexto local
      Medido desde el ordenador del jugador, en Windows, con GameRoute.
      Tipo de conexión local (Wi-Fi o cable): no medido.
      Las direcciones de la red local no figuran en este informe."
    `)
  })

  it('stays short when no match is selected', () => {
    expect(reportText([], { ...full, locale: 'en' })).toMatchInlineSnapshot(`
      "GameRoute connection report
      Prepared on October 8, 2026 at 14:32 · For the support of the internet provider

      No match selected."
    `)
    expect(reportText([], { ...full, locale: 'fr' })).toMatchInlineSnapshot(`
      "Rapport de connexion GameRoute
      Préparé le 8 octobre 2026 à 14:32 · À l'attention du support du fournisseur d'accès

      Aucune partie sélectionnée."
    `)
    expect(reportText([], { ...full, locale: 'es' })).toMatchInlineSnapshot(`
      "Informe de conexión de GameRoute
      Preparado el 8 de octubre de 2026 a las 14:32 · Para el soporte del proveedor de acceso

      Ninguna partida seleccionada."
    `)
  })

  it('hides the addresses of the local network unless asked', () => {
    const { detail, matches } = lossyCase()
    const masked = reportText(sources(detail, matches, [1]), { ...full, locale: 'en' })
    const shown = reportText(sources(detail, matches, [1]), {
      ...full,
      addresses: true,
      locale: 'en',
    })

    expect(masked).not.toContain('192.168.1.254')
    expect(masked).toContain('Your home')
    expect(shown).toContain('192.168.1.254')
    expect(masked).toContain('ae1-9.rt.th2.par.fr.retn.net (87.245.233.46)')
  })

  it('leaves out the route and the hops when they are switched off', () => {
    const { detail, matches } = lossyCase()
    const text = reportText(sources(detail, matches, [1]), {
      ...full,
      route: false,
      hops: false,
      locale: 'en',
    })

    expect(text).not.toContain('Route:')
    expect(text).not.toContain('Hops:')
    expect(text).not.toContain('ae1-9')
  })

  it('addresses the report to the operators found on the route', () => {
    const { detail, matches } = lossyCase()
    const all = sources(detail, matches, [1, 2])

    expect(reportIspName(all)).toBe('SFR')
    expect(reportPublisherName(all)).toBe('Riot Games')
    expect(reportText(all, { ...full, recipient: 'isp', locale: 'en' })).toContain(
      'For SFR support'
    )
    expect(reportText(all, { ...full, recipient: 'publisher', locale: 'en' })).toContain(
      'For Riot Games support'
    )
  })
})

describe('defaultReportSelection', () => {
  const candidates = (statuses: SessionMatch['status'][]): ReportCandidate[] =>
    statuses.map((status, index) => ({
      key: reportCandidateKey(1, index + 1),
      sessionId: 1,
      gameName: 'VALORANT',
      match: {
        ...sessionMatches()[0],
        number: index + 1,
        status,
        trace: status === 'unmeasured' ? null : measure(),
      },
    }))

  it('ticks the matches that depart from the usual ping, then one match without loss to compare', () => {
    expect(defaultReportSelection(candidates(['ok', 'degraded', 'ok', 'watch']))).toEqual([
      '1:2',
      '1:4',
      '1:1',
    ])
  })

  it('falls back to the latest measured match when nothing stands out', () => {
    expect(defaultReportSelection(candidates(['unmeasured', 'ok', 'ok']))).toEqual(['1:2'])
  })

  it('stays on the session the report was opened from', () => {
    const others = candidates(['critical']).map(candidate => ({
      ...candidate,
      sessionId: 2,
      key: '2:1',
    }))
    expect(defaultReportSelection([...others, ...candidates(['ok'])], 1)).toEqual(['1:1'])
  })
})

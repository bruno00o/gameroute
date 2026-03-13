# GameRoute Audit Backlog

Généré le 2026-03-08. Chaque item est coché une fois corrigé et committé.

## Légende
- 🔴 CRITIQUE — bloque le release ou risque de crash/sécurité
- 🟡 IMPORTANT — doit être corrigé rapidement
- 🟢 NICE-TO-HAVE — amélioration qualité

---

## Phase 1 — Robustesse critique (code)

- [x] 🔴 R1: Race condition monitoring start — combiner read+write lock ✅
- [x] 🔴 R2: Race condition traceroute queue — combiner read+write lock ✅
- [x] 🔴 R3: Panic icône tray au démarrage — expect avec message descriptif ✅
- [x] 🔴 R4: Event listeners cleanup frontend — fix promise chain ✅
- [x] ~~R5: Service health check stale closure~~ — faux positif

## Phase 2 — Sécurité

- [x] ~~F10: NULL DACL sur named pipe~~ — faux positif, DACL restreint à BUILTIN\Users
- [ ] 🟡 F11: ASN resolution en HTTP pas HTTPS — limitation du plan gratuit ip-api.com
- [x] 🟡 R9: Protocole non validé côté backend — valider TCP/UDP/ICMP ✅
- [x] 🟢 R13: NonZeroUsize unwrap ASN resolver — expect avec message ✅

## Phase 3 — UX critique (value prop)

- [x] 🔴 U1: Dashboard sans métrique réseau — ajout verdict réseau + stats game servers ✅
- [x] 🔴 U2: Aucun verdict réseau global — système Good/Fair/Poor avec ratio ✅
- [x] 🔴 U3: Trace page 100% Layer 3 — verdict par IP tracée ✅
- [x] 🔴 U4: Colonnes ASN/ISP jargon pur — fusionnées en "Provider (ASN)" ✅
- [x] 🔴 U5: Chaînes hardcodées non traduites — "Source", "% problems", "pkt" ✅

## Phase 4 — Robustesse important

- [x] 🟡 R6: Émissions Tauri silencieusement ignorées (13 occurrences) — log::warn ✅
- [x] 🟡 R7: Pas de timeout named pipe reads — ajouter timeout ✅
- [x] 🟡 R8: Pas de timeout cycle poll game detection — ajouter timeout wrapper ✅
- [x] 🟡 R10: ErrorBoundary ne couvre pas header/sidebar — englober le layout ✅
- [x] 🟡 R11: Zustand Set muté en place — créer nouveau Set ✅
- [x] 🟡 R12: Pas de nettoyage vieilles sessions DB — politique de rétention ✅

## Phase 5 — UX important

- [x] 🟡 U6: Widget monitoring — fond accent pour visibilité ✅
- [x] 🟡 U7: Welcome page sans mention performance — ajouter carte impact perf ✅
- [x] 🟡 U8: Banner service unavailable trop technique — reformulé ✅
- [x] 🟡 U9: Pas de comparaison entre sessions — delta vs session précédente ✅
- [x] 🟡 U10: Section cache settings trop technique — progressive disclosure ✅
- [x] 🟡 U11: Glossaire isolé dans Help — tooltips contextuels sur termes techniques ✅
- [x] 🟡 U12: "Total packets" inutile en session overview — remplacer par stabilité ✅
- [x] 🟡 U13: Navigation fragmentée (8 entrées) — fusionner Network+Insights ✅
- [x] 🟡 U14: Erreurs monitoring non actionables — messages compréhensibles ✅
- [x] 🟡 U15: aria-labels manquants — ajouter sur éléments interactifs ✅

## Phase 6 — Features release

- [ ] 🔴 F1: Code signing Windows — configurer certificat + workflow
- [ ] 🔴 F2: Auto-update Tauri — configurer updater plugin
- [ ] 🔴 F3: Crash reporting / logs centralisés — intégrer solution
- [ ] 🔴 F4: Nettoyage service désinstallation — fiabiliser NSIS hooks
- [x] 🟡 F5: Export données CSV — sessions, insights, traceroutes ✅
- [x] 🟡 F18: Export vers LLMs — générer un résumé structuré (markdown/texte) d'une session ou du réseau avec bouton "Copier pour Claude/ChatGPT/Gemini". Inclure contexte (jeu, durée, serveurs), traceroutes, problem hops, et une question pré-formulée pour que le LLM puisse diagnostiquer. ✅
- [x] 🟡 F6: Recherche/filtre page Sessions — search box + backend ✅
- [x] 🟡 F7: UX service health check — bouton "Corriger" + guidance ✅
- [ ] 🟡 F8: Tests CI sur Windows — ajouter Windows runner
- [ ] 🟡 F9: README / docs installation — écrire documentation

## Phase 7 — Nice-to-have

- [x] 🟢 R14: Connect timeout explicite pool SQLite ✅
- [x] ~~R15: Loading indicator file dialog~~ — non applicable, les dialogues natifs OS bloquent l'UI directement
- [x] 🟢 R16: Optimistic updates mutations games ✅
- [x] 🟢 U16: Export CSV/JSON pour Romain — couvert par F5 ✅
- [x] 🟢 U17: Path exécutable visible dans liste jeux ✅
- [x] 🟢 U18: Tooltip "Manuel" plus explicite ✅
- [x] 🟢 U19: Lien Help depuis welcome ✅
- [ ] 🟢 F12: System tray notifications réseau
- [ ] 🟢 F13: CLI pour automatisation
- [ ] 🟢 F14: Backup/restore config
- [ ] 🟢 F15: Sélection interface réseau
- [ ] 🟢 F16: Tagging/notes sessions
- [ ] 🟢 F17: Détection VPN active

## Observations terrain (session Valorant 2026-03-08)

- [x] 🟡 U20: Incohérence problem hops session vs network analytics — la session montre 37 problem hops (toutes les IPs confondues) alors que network analytics en montre 4 (filtrées game server uniquement). Il faut décider : filtrer aussi côté session pour ne compter que les hops sur les routes game server, ou afficher les deux métriques séparément.
- [x] 🟡 U21: Latence affichée trompeuse quand ICMP bloqué — sur un serveur Azure Frankfurt (20.47.65.124), la latence affichée est 152.7ms (dernier hop répondant) alors que le second serveur Azure Frankfurt (20.157.75.87) affiche 13.3ms sur une route quasi identique. Le premier traceroute avait un saut problématique à hop 8 (13ms→151ms) qui a gonflé toute la suite. Ça donne l'impression d'un mauvais serveur alors que c'est probablement un problème transitoire sur la route. Pistes : afficher la latence médiane au lieu de la dernière, ou indiquer clairement quand le serveur bloque ICMP et que la latence est estimée.

export type City = { id: string; name: string; lat: number; lon: number }

const CITIES: Record<string, Omit<City, 'id'>> = {
  paris: { name: 'Paris', lat: 48.86, lon: 2.35 },
  lyon: { name: 'Lyon', lat: 45.76, lon: 4.84 },
  marseille: { name: 'Marseille', lat: 43.3, lon: 5.37 },
  toulouse: { name: 'Toulouse', lat: 43.6, lon: 1.44 },
  bordeaux: { name: 'Bordeaux', lat: 44.84, lon: -0.58 },
  lille: { name: 'Lille', lat: 50.63, lon: 3.06 },
  nantes: { name: 'Nantes', lat: 47.22, lon: -1.55 },
  rennes: { name: 'Rennes', lat: 48.11, lon: -1.68 },
  strasbourg: { name: 'Strasbourg', lat: 48.57, lon: 7.75 },
  nice: { name: 'Nice', lat: 43.7, lon: 7.27 },
  montpellier: { name: 'Montpellier', lat: 43.61, lon: 3.88 },
  frankfurt: { name: 'Frankfurt', lat: 50.11, lon: 8.68 },
  london: { name: 'London', lat: 51.51, lon: -0.13 },
  amsterdam: { name: 'Amsterdam', lat: 52.37, lon: 4.9 },
  brussels: { name: 'Brussels', lat: 50.85, lon: 4.35 },
  madrid: { name: 'Madrid', lat: 40.42, lon: -3.7 },
  barcelona: { name: 'Barcelona', lat: 41.39, lon: 2.17 },
  lisbon: { name: 'Lisbon', lat: 38.72, lon: -9.14 },
  milan: { name: 'Milan', lat: 45.46, lon: 9.19 },
  zurich: { name: 'Zurich', lat: 47.38, lon: 8.54 },
  geneva: { name: 'Geneva', lat: 46.2, lon: 6.14 },
  vienna: { name: 'Vienna', lat: 48.21, lon: 16.37 },
  warsaw: { name: 'Warsaw', lat: 52.23, lon: 21.01 },
  prague: { name: 'Prague', lat: 50.08, lon: 14.44 },
  budapest: { name: 'Budapest', lat: 47.5, lon: 19.04 },
  bucharest: { name: 'Bucharest', lat: 44.43, lon: 26.1 },
  sofia: { name: 'Sofia', lat: 42.7, lon: 23.32 },
  athens: { name: 'Athens', lat: 37.98, lon: 23.73 },
  stockholm: { name: 'Stockholm', lat: 59.33, lon: 18.07 },
  copenhagen: { name: 'Copenhagen', lat: 55.68, lon: 12.57 },
  oslo: { name: 'Oslo', lat: 59.91, lon: 10.75 },
  helsinki: { name: 'Helsinki', lat: 60.17, lon: 24.94 },
  berlin: { name: 'Berlin', lat: 52.52, lon: 13.4 },
  hamburg: { name: 'Hamburg', lat: 53.55, lon: 9.99 },
  munich: { name: 'Munich', lat: 48.14, lon: 11.58 },
  dusseldorf: { name: 'Düsseldorf', lat: 51.23, lon: 6.77 },
  dublin: { name: 'Dublin', lat: 53.35, lon: -6.26 },
  ashburn: { name: 'Ashburn', lat: 39.04, lon: -77.49 },
  newyork: { name: 'New York', lat: 40.71, lon: -74.01 },
  chicago: { name: 'Chicago', lat: 41.88, lon: -87.63 },
  dallas: { name: 'Dallas', lat: 32.78, lon: -96.8 },
  atlanta: { name: 'Atlanta', lat: 33.75, lon: -84.39 },
  miami: { name: 'Miami', lat: 25.76, lon: -80.19 },
  losangeles: { name: 'Los Angeles', lat: 34.05, lon: -118.24 },
  sanjose: { name: 'San Jose', lat: 37.34, lon: -121.89 },
  seattle: { name: 'Seattle', lat: 47.61, lon: -122.33 },
}

const NAMES: Record<string, string> = {
  ...Object.fromEntries(Object.keys(CITIES).map(id => [id, id])),
  frankfurtammain: 'frankfurt',
  bruxelles: 'brussels',
  milano: 'milan',
  wien: 'vienna',
  praha: 'prague',
  muenchen: 'munich',
  munchen: 'munich',
  duesseldorf: 'dusseldorf',
  kobenhavn: 'copenhagen',
}

const CODES: Record<string, string> = {
  par: 'paris',
  prs: 'paris',
  cdg: 'paris',
  ory: 'paris',
  lyo: 'lyon',
  lys: 'lyon',
  mrs: 'marseille',
  fra: 'frankfurt',
  ffm: 'frankfurt',
  lon: 'london',
  ldn: 'london',
  lhr: 'london',
  ams: 'amsterdam',
  bru: 'brussels',
  mad: 'madrid',
  bcn: 'barcelona',
  lis: 'lisbon',
  mil: 'milan',
  mxp: 'milan',
  zrh: 'zurich',
  gva: 'geneva',
  vie: 'vienna',
  waw: 'warsaw',
  prg: 'prague',
  bud: 'budapest',
  buh: 'bucharest',
  otp: 'bucharest',
  sof: 'sofia',
  ath: 'athens',
  sto: 'stockholm',
  arn: 'stockholm',
  cph: 'copenhagen',
  osl: 'oslo',
  hel: 'helsinki',
  ber: 'berlin',
  ham: 'hamburg',
  muc: 'munich',
  dus: 'dusseldorf',
  dub: 'dublin',
  ash: 'ashburn',
  iad: 'ashburn',
  nyc: 'newyork',
  jfk: 'newyork',
  ewr: 'newyork',
  chi: 'chicago',
  ord: 'chicago',
  dal: 'dallas',
  dfw: 'dallas',
  atl: 'atlanta',
  mia: 'miami',
  lax: 'losangeles',
  sjc: 'sanjose',
  sea: 'seattle',
}

const TELIA_CODES: Record<string, string> = {
  ...CODES,
  hbg: 'hamburg',
  kbn: 'copenhagen',
  war: 'warsaw',
  nyk: 'newyork',
  dls: 'dallas',
  sjo: 'sanjose',
}

const RETN_CODES: Record<string, string> = { ...CODES, fkt: 'frankfurt', lnd: 'london' }

const NTT_CODES: Record<string, string> = {
  parsfr: 'paris',
  frnkge: 'frankfurt',
  londen: 'london',
  amstnl: 'amsterdam',
  mdrdsp: 'madrid',
  mlanit: 'milan',
  asbnva: 'ashburn',
  nwrknj: 'newyork',
  chcgil: 'chicago',
  dllstx: 'dallas',
  lsanca: 'losangeles',
  snjsca: 'sanjose',
  sttlwa: 'seattle',
  miamfl: 'miami',
  atlnga: 'atlanta',
}

const FREE_PARIS = /^(p\d+|th2|th3|bzn)$/

type Rule = { domains: string[]; find: (labels: string[]) => string | undefined }

const tokens = (labels: string[]) => labels.flatMap(label => label.split('-'))

const coded = (table: Record<string, string>, pattern: RegExp) => (parts: string[]) =>
  parts.map(part => table[pattern.exec(part)?.[1] ?? '']).find(Boolean)

const named = (parts: string[]) => parts.map(part => NAMES[part.replace(/\d+$/, '')]).find(Boolean)

const RULES: Rule[] = [
  {
    domains: ['twelve99.net', 'telia.net'],
    find: labels => TELIA_CODES[/^([a-z]{3})-/.exec(labels[0])?.[1] ?? ''],
  },
  { domains: ['he.net', 'ntwk.msn.net', 'zayo.com'], find: coded(CODES, /^([a-z]{3})\d+$/) },
  { domains: ['cogentco.com'], find: coded(CODES, /^([a-z]{3})\d{2}$/) },
  { domains: ['gtt.net'], find: labels => coded(CODES, /^([a-z]{3})\d+$/)(tokens(labels)) },
  {
    domains: ['retn.net'],
    find: labels =>
      labels
        .slice(0, -1)
        .map((label, i) => (/^[a-z]{2}$/.test(labels[i + 1]) ? RETN_CODES[label] : undefined))
        .find(Boolean),
  },
  { domains: ['gin.ntt.net'], find: coded(NTT_CODES, /^([a-z]{6})\d+$/) },
  { domains: ['level3.net', 'lumen.tech', 'centurylink.net'], find: named },
  {
    domains: ['proxad.net'],
    find: labels => (FREE_PARIS.test(tokens(labels)[0]) ? 'paris' : named(tokens(labels))),
  },
  {
    domains: [
      'sfr.net',
      'neufcegetel.fr',
      'francetelecom.net',
      'opentransit.net',
      'as5511.net',
      'bouyguestelecom.net',
    ],
    find: labels => named(tokens(labels)),
  },
]

export function cityFromHostname(hostname: string | null | undefined): City | null {
  const host = hostname?.trim().toLowerCase().replace(/\.$/, '')
  if (!host) return null
  for (const rule of RULES) {
    const domain = rule.domains.find(d => host === d || host.endsWith(`.${d}`))
    if (!domain) continue
    const labels = host.slice(0, -domain.length).split('.').filter(Boolean)
    const id = rule.find(labels)
    return id ? { id, ...CITIES[id] } : null
  }
  return null
}

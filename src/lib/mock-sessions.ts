export type SessionHop = {
  hop: number
  ip: string
  hostname: string
  latency: number
  location: string
  status: 'ok' | 'timeout' | 'high-latency'
}

export type Session = {
  id: string
  game: string
  server: string
  region: string
  date: string
  duration: number
  status: 'completed' | 'active' | 'failed'
  hops: SessionHop[]
}

export const mockSessions: Session[] = [
  {
    id: '1',
    game: 'Valorant',
    server: 'eu-west-1.valorant.net',
    region: 'EU West',
    date: '2026-01-30T14:23:00Z',
    duration: 2340,
    status: 'completed',
    hops: [
      { hop: 1, ip: '192.168.1.1', hostname: 'gateway.local', latency: 1, location: 'Local', status: 'ok' },
      { hop: 2, ip: '10.0.0.1', hostname: 'isp-gw.orange.fr', latency: 8, location: 'Paris, FR', status: 'ok' },
      { hop: 3, ip: '80.10.246.2', hostname: 'ae41.par-th2.fr.orange.net', latency: 12, location: 'Paris, FR', status: 'ok' },
      { hop: 4, ip: '193.252.160.49', hostname: 'ae12.mrs-5.fr.orange.net', latency: 18, location: 'Marseille, FR', status: 'ok' },
      { hop: 5, ip: '154.54.58.185', hostname: 'be3048.ccr42.par04.atlas.cogentco.com', latency: 15, location: 'Paris, FR', status: 'ok' },
      { hop: 6, ip: '130.117.51.42', hostname: 'be2814.ccr42.ams03.atlas.cogentco.com', latency: 22, location: 'Amsterdam, NL', status: 'ok' },
      { hop: 7, ip: '185.40.64.3', hostname: 'riot-gw.ams.cogentco.com', latency: 24, location: 'Amsterdam, NL', status: 'ok' },
      { hop: 8, ip: '104.160.141.8', hostname: 'eu-west-1.valorant.net', latency: 26, location: 'Dublin, IE', status: 'ok' },
    ],
  },
  {
    id: '2',
    game: 'League of Legends',
    server: 'euw1.lol.riotgames.com',
    region: 'EU West',
    date: '2026-01-30T11:05:00Z',
    duration: 1870,
    status: 'completed',
    hops: [
      { hop: 1, ip: '192.168.1.1', hostname: 'gateway.local', latency: 1, location: 'Local', status: 'ok' },
      { hop: 2, ip: '10.0.0.1', hostname: 'isp-gw.orange.fr', latency: 9, location: 'Paris, FR', status: 'ok' },
      { hop: 3, ip: '80.10.246.2', hostname: 'ae41.par-th2.fr.orange.net', latency: 11, location: 'Paris, FR', status: 'ok' },
      { hop: 4, ip: '154.54.58.185', hostname: 'be3048.ccr42.par04.atlas.cogentco.com', latency: 14, location: 'Paris, FR', status: 'ok' },
      { hop: 5, ip: '130.117.51.42', hostname: 'be2814.ccr42.ams03.atlas.cogentco.com', latency: 21, location: 'Amsterdam, NL', status: 'ok' },
      { hop: 6, ip: '185.40.64.3', hostname: 'riot-gw.ams.cogentco.com', latency: 23, location: 'Amsterdam, NL', status: 'ok' },
      { hop: 7, ip: '104.160.141.12', hostname: 'euw1.lol.riotgames.com', latency: 25, location: 'Amsterdam, NL', status: 'ok' },
    ],
  },
  {
    id: '3',
    game: 'Counter-Strike 2',
    server: 'sto1.valve.net',
    region: 'EU North',
    date: '2026-01-29T20:48:00Z',
    duration: 3120,
    status: 'failed',
    hops: [
      { hop: 1, ip: '192.168.1.1', hostname: 'gateway.local', latency: 1, location: 'Local', status: 'ok' },
      { hop: 2, ip: '10.0.0.1', hostname: 'isp-gw.orange.fr', latency: 8, location: 'Paris, FR', status: 'ok' },
      { hop: 3, ip: '80.10.246.2', hostname: 'ae41.par-th2.fr.orange.net', latency: 13, location: 'Paris, FR', status: 'ok' },
      { hop: 4, ip: '62.115.116.170', hostname: 'nyk-bb1-link.ip.twelve99.net', latency: 28, location: 'Frankfurt, DE', status: 'ok' },
      { hop: 5, ip: '62.115.142.215', hostname: 'sto-b2-link.ip.twelve99.net', latency: 42, location: 'Stockholm, SE', status: 'high-latency' },
      { hop: 6, ip: '213.248.97.66', hostname: 'valve-ic.ip.twelve99.net', latency: 45, location: 'Stockholm, SE', status: 'high-latency' },
      { hop: 7, ip: '***', hostname: '***', latency: -1, location: 'Unknown', status: 'timeout' },
      { hop: 8, ip: '***', hostname: '***', latency: -1, location: 'Unknown', status: 'timeout' },
      { hop: 9, ip: '146.66.152.1', hostname: 'sto1.valve.net', latency: 68, location: 'Stockholm, SE', status: 'high-latency' },
    ],
  },
  {
    id: '4',
    game: 'Fortnite',
    server: 'fortnite-eu.epicgames.com',
    region: 'EU Central',
    date: '2026-01-29T17:30:00Z',
    duration: 1540,
    status: 'completed',
    hops: [
      { hop: 1, ip: '192.168.1.1', hostname: 'gateway.local', latency: 1, location: 'Local', status: 'ok' },
      { hop: 2, ip: '10.0.0.1', hostname: 'isp-gw.orange.fr', latency: 7, location: 'Paris, FR', status: 'ok' },
      { hop: 3, ip: '80.10.246.2', hostname: 'ae41.par-th2.fr.orange.net', latency: 10, location: 'Paris, FR', status: 'ok' },
      { hop: 4, ip: '62.115.116.168', hostname: 'ffm-bb1-link.ip.twelve99.net', latency: 19, location: 'Frankfurt, DE', status: 'ok' },
      { hop: 5, ip: '62.115.155.73', hostname: 'amazon-ic.ip.twelve99.net', latency: 20, location: 'Frankfurt, DE', status: 'ok' },
      { hop: 6, ip: '52.93.29.81', hostname: 'aws-fra.amazon.com', latency: 21, location: 'Frankfurt, DE', status: 'ok' },
      { hop: 7, ip: '3.120.45.67', hostname: 'fortnite-eu.epicgames.com', latency: 22, location: 'Frankfurt, DE', status: 'ok' },
    ],
  },
  {
    id: '5',
    game: 'Apex Legends',
    server: 'eu-west.apexlegends.ea.com',
    region: 'EU West',
    date: '2026-01-28T22:15:00Z',
    duration: 2780,
    status: 'completed',
    hops: [
      { hop: 1, ip: '192.168.1.1', hostname: 'gateway.local', latency: 1, location: 'Local', status: 'ok' },
      { hop: 2, ip: '10.0.0.1', hostname: 'isp-gw.orange.fr', latency: 9, location: 'Paris, FR', status: 'ok' },
      { hop: 3, ip: '80.10.246.2', hostname: 'ae41.par-th2.fr.orange.net', latency: 12, location: 'Paris, FR', status: 'ok' },
      { hop: 4, ip: '154.54.58.185', hostname: 'be3048.ccr42.par04.atlas.cogentco.com', latency: 15, location: 'Paris, FR', status: 'ok' },
      { hop: 5, ip: '154.54.56.130', hostname: 'be2818.ccr42.lon13.atlas.cogentco.com', latency: 20, location: 'London, UK', status: 'ok' },
      { hop: 6, ip: '130.117.15.86', hostname: 'multiplay-gw.lon13.cogentco.com', latency: 22, location: 'London, UK', status: 'ok' },
      { hop: 7, ip: '159.153.40.10', hostname: 'multiplay-lon.ea.com', latency: 23, location: 'London, UK', status: 'ok' },
      { hop: 8, ip: '159.153.40.50', hostname: 'eu-west.apexlegends.ea.com', latency: 24, location: 'London, UK', status: 'ok' },
    ],
  },
]

export function getSession(id: string): Session | undefined {
  return mockSessions.find((s) => s.id === id)
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

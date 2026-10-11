export const MIN_PLAYERS = 30
export const MIN_MATCHES = 200

export interface Game {
  id: string
  name: string
  gameMeasuredPing: boolean
}

export const GAMES: Game[] = [
  { id: 'valorant', name: 'VALORANT', gameMeasuredPing: true },
  { id: 'league-of-legends', name: 'League of Legends', gameMeasuredPing: true },
  { id: 'counter-strike-2', name: 'Counter-Strike 2', gameMeasuredPing: false },
]

export const COUNTRIES = ['FR', 'BE', 'CH', 'CA', 'DE', 'GB', 'US', 'ES'] as const

export type Country = (typeof COUNTRIES)[number]

export interface RankedIsp {
  rank: number
  tied: boolean
  name: string
  asn: number
  players: number
  matches: number
  cleanShare: number
  ciHalfWidth: number
}

export interface CollectingIsp {
  name: string
  players: number
}

export interface Ranking {
  players: number
  matches: number
  ranked: RankedIsp[]
  collecting: CollectingIsp[]
}

export const EMPTY_RANKING: Ranking = { players: 0, matches: 0, ranked: [], collecting: [] }

export function getRanking(_gameId: string, _country: Country): Ranking {
  return EMPTY_RANKING
}

export type Reliability = 'high' | 'medium' | 'low'

export function reliability(ciHalfWidth: number): Reliability {
  if (ciHalfWidth <= 1.5) return 'high'
  if (ciHalfWidth <= 3) return 'medium'
  return 'low'
}

export function rampColor(cleanShare: number) {
  if (cleanShare >= 94) return 'bg-bar-1'
  if (cleanShare >= 92) return 'bg-bar-2'
  if (cleanShare >= 89) return 'bg-bar-3'
  if (cleanShare >= 85) return 'bg-bar-4'
  return 'bg-bar-5'
}

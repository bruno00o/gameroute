export const PRODUCT_NAME = 'GameRoute'

export const ROUTE_ZONES = ['home', 'isp', 'transit', 'service'] as const

export type RouteZone = (typeof ROUTE_ZONES)[number]

export const MEASUREMENT_SOURCES = ['game', 'probe'] as const

export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number]

export const REPORT_TTL_DAYS = 90

export const MAX_ZONE_CELL_RESOLUTION = 5

export const MIN_PLAYERS_PER_ISP = 30

export const MIN_PLAYERS_PER_ISP_ZONE = 10

export const REPORT_GAMES = {
  valorant: 'VALORANT',
  'league-of-legends': 'League of Legends',
  'counter-strike-2': 'Counter-Strike 2',
} as const

export type ReportGameSlug = keyof typeof REPORT_GAMES

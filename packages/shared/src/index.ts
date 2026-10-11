export const PRODUCT_NAME = 'GameRoute'

export const ROUTE_ZONES = ['home', 'isp', 'transit', 'service'] as const

export type RouteZone = (typeof ROUTE_ZONES)[number]

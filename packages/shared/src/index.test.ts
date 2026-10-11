import { describe, expect, it } from 'vitest'
import { MIN_PLAYERS_PER_ISP, MIN_PLAYERS_PER_ISP_ZONE, PRODUCT_NAME, ROUTE_ZONES } from './index'

describe('shared', () => {
  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('GameRoute')
  })

  it('orders route zones from the player to the server', () => {
    expect(ROUTE_ZONES).toEqual(['home', 'isp', 'transit', 'service'])
  })

  it('never publishes a zone aggregate with fewer players than an ISP aggregate allows', () => {
    expect(MIN_PLAYERS_PER_ISP_ZONE).toBeGreaterThan(0)
    expect(MIN_PLAYERS_PER_ISP_ZONE).toBeLessThanOrEqual(MIN_PLAYERS_PER_ISP)
  })
})

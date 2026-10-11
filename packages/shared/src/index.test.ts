import { describe, expect, it } from 'vitest'
import { PRODUCT_NAME, ROUTE_ZONES } from './index'

describe('shared', () => {
  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('GameRoute')
  })

  it('orders route zones from the player to the server', () => {
    expect(ROUTE_ZONES).toEqual(['home', 'isp', 'transit', 'service'])
  })
})

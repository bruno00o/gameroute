import { describe, expect, it } from 'vitest'

import { cityFromHostname } from './hostname-city'

const city = (hostname: string | null) => cityFromHostname(hostname)?.name ?? null

describe('cityFromHostname', () => {
  it.each([
    ['prs-bb1-link.ip.twelve99.net', 'Paris'],
    ['ffm-bb2-link.ip.twelve99.net', 'Frankfurt'],
    ['lax-b5-link.ip.twelve99.net', 'Los Angeles'],
    ['ash-bb2-link.ip.twelve99.net', 'Ashburn'],
    ['bas1.paris.sfr.net', 'Paris'],
    ['ae42-0.nipoi201.lyon.francetelecom.net', 'Lyon'],
    ['p11-9k-1-be1003.intf.routers.proxad.net', 'Paris'],
    ['th2-9k-3-be1005.intf.routers.proxad.net', 'Paris'],
    ['be2391.ccr42.par01.atlas.cogentco.com', 'Paris'],
    ['be3187.ccr41.fra03.atlas.cogentco.com', 'Frankfurt'],
    ['ae-1-3502.ear2.Paris1.Level3.net', 'Paris'],
    ['lag-1.ear3.Frankfurt1.Level3.net.', 'Frankfurt'],
    ['ae1-9.rt.tc2.par.fr.retn.net', 'Paris'],
    ['ae5-6.RT.IRX.FKT.DE.retn.net', 'Frankfurt'],
    ['100ge9-1.core1.par2.he.net', 'Paris'],
    ['port-channel1.core2.ams1.he.net', 'Amsterdam'],
    ['ae1230-0.icr01.fra23.ntwk.msn.net', 'Frankfurt'],
    ['ae27.cs1.cdg12.fr.eth.zayo.com', 'Paris'],
    ['ae11.cr0-par7.ip4.gtt.net', 'Paris'],
    ['ae-3.r20.parsfr04.fr.bb.gin.ntt.net', 'Paris'],
  ])('reads the city of %s', (hostname, expected) => {
    expect(city(hostname)).toBe(expected)
  })

  it.each([
    null,
    '',
    '18.254.69.86.rev.sfr.net',
    'microsoft-ic-375958.ip.twelve99-cust.net',
    'ae40-tcr1.pat.cw.net',
    'xyz-bb1-link.ip.twelve99.net',
    'paris.example.com',
    'prs-bb1-link.ip.twelve99.net.evil.com',
    'be2391.ccr42.xyz01.atlas.cogentco.com',
    'router.local',
  ])('places nothing for %s', hostname => {
    expect(city(hostname)).toBeNull()
  })

  it('returns coordinates with the city', () => {
    expect(cityFromHostname('prs-bb1-link.ip.twelve99.net')).toMatchObject({
      id: 'paris',
      lat: expect.closeTo(48.86, 1),
      lon: expect.closeTo(2.35, 1),
    })
  })
})

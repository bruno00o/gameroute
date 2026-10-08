import type { OperatorRoute } from '@/types/backend'

export const EXAMPLE_ROUTE: OperatorRoute = {
  segments: [
    {
      zone: 'home',
      asn: null,
      name: null,
      firstHop: 1,
      lastHop: 2,
      hops: 2,
      silentHops: 0,
      addedMs: 0.7,
      status: null,
    },
    {
      zone: 'isp',
      asn: 15557,
      name: 'SFR',
      firstHop: 3,
      lastHop: 5,
      hops: 3,
      silentHops: 0,
      addedMs: 4.3,
      status: null,
    },
    {
      zone: 'transit',
      asn: 9002,
      name: 'RETN',
      firstHop: 6,
      lastHop: 7,
      hops: 2,
      silentHops: 1,
      addedMs: 12,
      status: null,
    },
  ],
  lastRespondingHop: 7,
  totalMs: 17,
  destinationSilent: true,
  destinationAsn: 6507,
  destinationName: 'Riot Games',
}

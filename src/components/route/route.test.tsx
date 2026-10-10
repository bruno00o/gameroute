import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DbHop, OperatorRoute, Severity } from '@/types/backend'
import { HopList } from './hop-list'
import { RouteStrip } from './route-strip'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const RIOT = '162.249.75.1'

function hop(
  hopNumber: number,
  ip: string | null,
  latency: number | null,
  packetLoss = 0,
  extra: Partial<DbHop> = {}
): DbHop {
  return {
    id: hopNumber,
    tracerouteId: 1,
    hopNumber,
    ip,
    hostname: null,
    latencyMin: latency,
    latencyAvg: latency,
    latencyMax: latency == null ? null : latency + 4,
    packetLoss: ip == null ? 100 : packetLoss,
    isProblemHop: false,
    source: null,
    lossStatus: null,
    ...extra,
  }
}

function sfrRetnRiot(): DbHop[] {
  return [
    hop(1, '10.0.10.1', 0.5, 66.7),
    hop(2, '192.168.1.1', 0.7),
    hop(3, '10.153.10.245', 3.7),
    hop(4, '77.128.4.142', 4.3),
    hop(5, '194.6.147.220', 3.7),
    hop(6, null, null),
    hop(7, '87.245.246.246', 5.3, 0, { hostname: 'ae4.rt.th2.par.fr.retn.net' }),
    hop(8, '87.245.233.46', 31.0),
  ]
}

function withPersistentLoss(hops: DbHop[]): DbHop[] {
  return hops.map(h =>
    h.hopNumber === 7
      ? { ...h, packetLoss: 30, lossStatus: 'critical' }
      : h.hopNumber === 8
        ? { ...h, packetLoss: 20, lossStatus: 'critical' }
        : h
  )
}

function sfrRetnRiotRoute(transitStatus: Severity | null = null): OperatorRoute {
  return {
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
        name: 'Societe Francaise Du Radiotelephone - SFR SA',
        firstHop: 3,
        lastHop: 5,
        hops: 3,
        silentHops: 0,
        addedMs: 3,
        status: null,
      },
      {
        zone: 'transit',
        asn: 9002,
        name: 'RETN Limited',
        firstHop: 6,
        lastHop: 8,
        hops: 3,
        silentHops: 1,
        addedMs: 27.3,
        status: transitStatus,
      },
    ],
    lastRespondingHop: 8,
    totalMs: 31,
    destinationSilent: true,
    destinationAsn: 6507,
    destinationName: 'Riot Games, Inc',
  }
}

function cloudflareRoute(): { hops: DbHop[]; route: OperatorRoute; target: string } {
  const target = '172.64.146.73'
  return {
    target,
    hops: [
      hop(1, '192.168.1.1', 0.7),
      hop(2, '86.69.254.18', 6.3),
      hop(3, '141.101.67.48', 3.7),
      hop(4, target, 5.7),
    ],
    route: {
      segments: [
        {
          zone: 'home',
          asn: null,
          name: null,
          firstHop: 1,
          lastHop: 1,
          hops: 1,
          silentHops: 0,
          addedMs: 0.7,
          status: null,
        },
        {
          zone: 'isp',
          asn: 15557,
          name: 'Societe Francaise Du Radiotelephone - SFR SA',
          firstHop: 2,
          lastHop: 2,
          hops: 1,
          silentHops: 0,
          addedMs: 3,
          status: null,
        },
        {
          zone: 'service',
          asn: 13335,
          name: 'Cloudflare, Inc.',
          firstHop: 3,
          lastHop: 4,
          hops: 2,
          silentHops: 0,
          addedMs: 2,
          status: null,
        },
      ],
      lastRespondingHop: 4,
      totalMs: 5.7,
      destinationSilent: false,
      destinationAsn: 13335,
      destinationName: 'Cloudflare, Inc.',
    },
  }
}

function hopRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[role=row][data-kind]'))
}

function rowOf(hopNumber: number) {
  return screen
    .getAllByRole('row')
    .find(row => row.querySelector('[role=cell]')?.textContent === String(hopNumber))!
}

function cells(row: HTMLElement) {
  return within(row).getAllByRole('cell')
}

describe('HopList', () => {
  it('groups hops under their operator without reordering them', () => {
    render(
      <HopList
        hops={sfrRetnRiot()}
        targetIp={RIOT}
        route={sfrRetnRiotRoute()}
        destinationName="Riot Games"
      />
    )

    const table = screen.getByRole('table', { name: 'Hops' })
    const groups = within(table)
      .getAllByRole('rowgroup')
      .filter(group => group.hasAttribute('aria-label'))
    expect(groups.map(group => group.getAttribute('aria-label'))).toEqual([
      'Your home',
      'Your ISP, SFR',
      'Transit, RETN',
    ])

    const numbers = (group: HTMLElement) =>
      hopRows(group).map(row => within(row).getAllByRole('cell')[0].textContent)
    expect(numbers(groups[0])).toEqual(['1', '2'])
    expect(numbers(groups[1])).toEqual(['3', '4', '5'])
    expect(numbers(groups[2])).toEqual(['6', '7', '8', '→'])

    expect(within(groups[1]).getByRole('rowheader')).toHaveTextContent(`SFRAS15557+3.0 ms`)
    expect(within(groups[2]).getByRole('rowheader')).toHaveTextContent(`+27 ms`)
  })

  it('lists hops flat when no route is known', () => {
    const { container } = render(<HopList hops={sfrRetnRiot()} targetIp={RIOT} route={null} />)

    expect(screen.queryByRole('rowheader')).toBeNull()
    expect(hopRows(container).map(row => cells(row)[0].textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '→',
    ])
  })

  it('hatches a silent hop and says it is normal, with no figures', () => {
    render(<HopList hops={sfrRetnRiot()} targetIp={RIOT} route={sfrRetnRiotRoute()} />)

    const row = rowOf(6)
    expect(row).toHaveAttribute('data-kind', 'silent')
    expect(row).toHaveTextContent("This router doesn't answer pings, which is normal")
    expect(row.querySelector('[data-rail]')).toHaveAttribute('data-rail', 'hatched')
    expect(
      cells(row)
        .slice(2)
        .map(cell => cell.textContent)
    ).toEqual(['', ''])
  })

  it('never colours a router that ignores some pings', () => {
    render(<HopList hops={sfrRetnRiot()} targetIp={RIOT} route={sfrRetnRiotRoute()} />)

    const row = rowOf(1)
    expect(row).toHaveAttribute('data-kind', 'rate-limited')
    expect(row).toHaveTextContent('Ignores some pings, which is normal')
    const loss = cells(row)[2]
    expect(loss).toHaveTextContent('67%')
    expect(loss.className).not.toMatch(/text-(watch|degraded|critical)/)
    expect(loss.querySelector('[data-slot=severity-glyph]')).toBeNull()
    expect(row.querySelector('[data-rail]')).toHaveAttribute('data-rail', 'route')
  })

  it('colours a persistent loss from the hop where it starts to the end', () => {
    const hops = withPersistentLoss(sfrRetnRiot())
    render(<HopList hops={hops} targetIp={RIOT} route={sfrRetnRiotRoute('critical')} />)

    const onset = rowOf(7)
    expect(onset).toHaveAttribute('data-kind', 'loss')
    expect(onset).toHaveTextContent('Loss starts here and carries on to the last responding hop.')
    const loss = cells(onset)[2]
    expect(loss).toHaveTextContent('30%')
    expect(loss).toHaveClass('text-critical')
    expect(loss.querySelector('[data-slot=severity-glyph]')).toHaveAttribute(
      'data-status',
      'critical'
    )

    expect(cells(rowOf(8))[2]).toHaveClass('text-critical')
    expect(rowOf(8)).not.toHaveTextContent('Loss starts here')

    const rails = (n: number) => rowOf(n).querySelector('[data-rail]')!.getAttribute('data-rail')
    expect([1, 5, 6, 7, 8].map(rails)).toEqual([
      'route',
      'route',
      'hatched',
      'critical',
      'critical',
    ])
  })

  it('ends on a silent destination with an at-least figure', () => {
    const { container } = render(
      <HopList
        hops={sfrRetnRiot()}
        targetIp={RIOT}
        route={sfrRetnRiotRoute()}
        destinationName="Riot Games"
      />
    )

    const rows = hopRows(container)
    const destination = rows[rows.length - 1]
    expect(destination).toHaveAttribute('data-kind', 'destination-silent')
    expect(destination).toHaveTextContent("Riot GamesDoesn't answer pings")
    expect(destination).toHaveTextContent('Measured up to hop 8 (RETN).')
    expect(cells(destination)[3]).toHaveTextContent(`≥ 31.0`)
  })

  it('marks the destination when it answers, without an extra line', () => {
    const { hops, route, target } = cloudflareRoute()
    const { container } = render(
      <HopList hops={hops} targetIp={target} route={route} destinationName="Cloudflare" />
    )

    const rows = hopRows(container)
    expect(rows).toHaveLength(4)
    expect(rows[3]).toHaveAttribute('data-kind', 'destination')
    expect(cells(rows[3])[0]).toHaveTextContent('→')
    expect(cells(rows[3])[1]).toHaveTextContent('Cloudflare')
    expect(cells(rows[3])[3]).toHaveTextContent('5.7')
    expect(screen.queryByText(/Doesn't answer pings/)).toBeNull()
  })

  it('shows the worst latency, address and probe source in the detailed view', () => {
    const hops = sfrRetnRiot().map(h => (h.hopNumber === 8 ? { ...h, source: 'UDP' } : h))
    render(<HopList hops={hops} targetIp={RIOT} route={sfrRetnRiotRoute()} mode="detail" />)

    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      '#',
      'Router',
      'Loss',
      'Avg ms',
      'Worst ms',
    ])
    expect(cells(rowOf(7))[1]).toHaveTextContent('ae4.rt.th2.par.fr.retn.net87.245.246.246')
    expect(cells(rowOf(8))[1]).toHaveTextContent('87.245.233.46UDP')
    expect(cells(rowOf(8))[4]).toHaveTextContent('35')
  })

  it('keeps the simple view to step, loss and ping', () => {
    render(<HopList hops={sfrRetnRiot()} targetIp={RIOT} route={sfrRetnRiotRoute()} />)

    expect(screen.getAllByRole('columnheader').map(header => header.textContent)).toEqual([
      '#',
      'Step',
      'Loss',
      'Ping ms',
    ])
    expect(cells(rowOf(7))[1]).toHaveTextContent(/^ae4\.rt\.th2\.par\.fr\.retn\.net$/)
  })
})

describe('RouteStrip', () => {
  const destination = { name: 'Riot Games', detail: RIOT }

  it('draws one segment per operator with short names, in route order', () => {
    render(<RouteStrip route={sfrRetnRiotRoute()} destination={destination} />)

    const route = screen.getByRole('list', { name: 'Route by operator' })
    const stops = within(route).getAllByRole('listitem')
    expect(stops.map(stop => stop.dataset.zone ?? 'destination')).toEqual([
      'home',
      'isp',
      'transit',
      'destination',
    ])
    expect(stops[0]).toHaveTextContent(`Your home+0.7 ms2 hops`)
    expect(stops[1]).toHaveTextContent(`Your ISPSFRAS15557+3.0 ms3 hops`)
    expect(stops[2]).toHaveTextContent(`TransitRETNAS9002+27 ms3 hops`)
    expect(stops[3]).toHaveTextContent(`Riot Games${RIOT}Doesn't answer pings`)
  })

  it('prefixes the total with ≥ when the destination is silent', () => {
    const { container } = render(
      <RouteStrip route={sfrRetnRiotRoute()} destination={destination} />
    )

    const total = container.querySelector('[data-slot=route-total]')!
    expect(total).toHaveTextContent(`≥ 31 msup to the last responding router`)
  })

  it('gives the total round trip when the destination answers', () => {
    const { route } = cloudflareRoute()
    const { container } = render(<RouteStrip route={route} destination={{ name: 'Cloudflare' }} />)

    const total = container.querySelector('[data-slot=route-total]')!
    expect(total).toHaveTextContent(`5.7 msround trip`)
    expect(total).not.toHaveTextContent('≥')
  })

  it('colours only the segment where a persistent loss starts', () => {
    render(
      <RouteStrip
        route={sfrRetnRiotRoute('critical')}
        destination={destination}
        persistentLoss={20}
      />
    )

    const stops = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(stops.map(stop => stop.dataset.status ?? null)).toEqual([null, null, 'critical', null])
    expect(stops[2]).toHaveTextContent('20% loss that persists to hop 8')
    expect(stops[2].querySelector('[data-slot=severity-glyph]')).toHaveAttribute(
      'data-status',
      'critical'
    )
    expect(stops[1].querySelector('.bg-critical, .bg-degraded, .bg-watch')).toBeNull()
  })

  it('paints each segment in its zone hue unless a status takes over', () => {
    render(
      <RouteStrip
        route={sfrRetnRiotRoute('critical')}
        destination={destination}
        persistentLoss={20}
      />
    )

    const stops = within(screen.getByRole('list')).getAllByRole('listitem')
    const pipe = (stop: HTMLElement) => stop.querySelector('[aria-hidden="true"] > :last-child')!
    expect(pipe(stops[0])).toHaveClass('bg-(--zone)')
    expect(pipe(stops[1])).toHaveClass('bg-(--zone)')
    expect(pipe(stops[2])).toHaveClass('bg-critical')
    expect(pipe(stops[2])).not.toHaveClass('bg-(--zone)')
  })

  it('stacks vertically when its container is narrow', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        callback: ResizeObserverCallback
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback
        }
        observe() {
          this.callback(
            [{ contentRect: { width: 400 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          )
        }
        disconnect() {}
      }
    )
    const { container } = render(
      <RouteStrip route={sfrRetnRiotRoute()} destination={destination} />
    )

    expect(container.querySelector('[data-slot=route-strip]')).toHaveAttribute(
      'data-orientation',
      'vertical'
    )
  })

  it('stays horizontal when there is room', () => {
    const { container } = render(
      <RouteStrip route={sfrRetnRiotRoute()} destination={destination} />
    )

    expect(container.querySelector('[data-slot=route-strip]')).toHaveAttribute(
      'data-orientation',
      'horizontal'
    )
  })
})

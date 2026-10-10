import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'

import type { UsualRoute } from '@/types/backend'
import { getUsualRoute } from '@/lib/tauri'
import { CommandMenu } from './command-menu'

vi.mock('@/lib/tauri', () => ({ getUsualRoute: vi.fn() }))

beforeAll(() => {
  window.scrollTo = vi.fn()
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function route(): UsualRoute {
  return {
    gameName: 'VALORANT',
    traceCount: 3,
    totalTraces: 3,
    persistentLoss: null,
    gamePing: null,
    route: {
      segments: [
        {
          zone: 'transit',
          asn: 9002,
          name: 'RETN Limited',
          firstHop: 1,
          lastHop: 3,
          hops: 3,
          silentHops: 0,
          addedMs: 12.9,
          status: null,
        },
      ],
      lastRespondingHop: 3,
      totalMs: 12.9,
      destinationSilent: true,
      destinationAsn: 6507,
      destinationName: 'Riot Games, Inc',
    },
    latest: {
      tracerouteId: 1,
      sessionId: 1,
      matchNumber: 1,
      startedAt: '2026-09-28T19:00:00Z',
      targetIp: '162.249.72.5',
      hops: [],
    },
  }
}

function renderMenu(onOpenChange = vi.fn()) {
  const rootRoute = createRootRoute({
    component: () => <CommandMenu open onOpenChange={onOpenChange} />,
  })
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
  const router = createRouter({
    routeTree: rootRoute.addChildren([stub('/route')]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

describe('CommandMenu', () => {
  it('finds an operator of the usual routes and opens it on the Route screen', async () => {
    vi.mocked(getUsualRoute).mockResolvedValue([route()])
    const onOpenChange = vi.fn()
    const router = renderMenu(onOpenChange)
    const user = userEvent.setup()

    await user.type(await screen.findByRole('combobox'), 'retn')
    await user.click(await screen.findByRole('option', { name: /RETN · transit/ }))

    expect(router.state.location.pathname).toBe('/route')
    expect(router.state.location.search).toEqual({ game: 'VALORANT', operator: 'AS9002' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('lists no operator group before any route is known', async () => {
    vi.mocked(getUsualRoute).mockResolvedValue([])
    renderMenu()

    await screen.findByRole('combobox')
    expect(screen.queryByText('Operators')).not.toBeInTheDocument()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'

import {
  getMatchRecap,
  getSessionDetail,
  getSessionMatches,
  getSeverityThresholds,
} from '@/lib/tauri'
import { matchRecap, sessionDetail, sessionMatches, thresholds } from '@/test/session-fixtures'
import { Route as SessionRoute } from './$id'
import { Route as MatchRoute } from './$id.matches.$n'
import { Route as RecapRoute } from './$id.matches.$n_.recap'

vi.mock('@/lib/tauri', () => ({
  getMatchRecap: vi.fn(),
  getSessionDetail: vi.fn(),
  getSessionMatches: vi.fn(),
  getSeverityThresholds: vi.fn(),
  deleteSession: vi.fn(),
  retryTraceroutes: vi.fn(),
  resolveAsn: vi.fn(() => new Promise(() => {})),
}))

vi.mock('@/lib/export-csv', () => ({ exportSessionDetail: vi.fn() }))
vi.mock('@/components/route/route-map', () => ({ RouteMap: () => null }))

const rootRoute = createRootRoute()
const sessionRoute = SessionRoute.update({
  id: '/sessions/$id',
  path: '/sessions/$id',
  getParentRoute: () => rootRoute,
} as never)
const matchRoute = MatchRoute.update({
  id: '/matches/$n',
  path: '/matches/$n',
  getParentRoute: () => sessionRoute,
} as never)
const recapRoute = RecapRoute.update({
  id: '/matches/$n/recap',
  path: '/matches/$n/recap',
  getParentRoute: () => sessionRoute,
} as never)
const routeTree = rootRoute.addChildren([sessionRoute.addChildren([matchRoute, recapRoute])])

function renderAt(url: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.mocked(getSessionDetail).mockResolvedValue(sessionDetail())
  vi.mocked(getSessionMatches).mockResolvedValue(sessionMatches())
  vi.mocked(getSeverityThresholds).mockResolvedValue(thresholds())
  vi.mocked(getMatchRecap).mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Match route', () => {
  it('opens a match from its number', async () => {
    renderAt('/sessions/1/matches/3')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Match 3 · 16:27 → 17:09'
    )
  })

  it('sends an old ?period= link to its match', async () => {
    const router = renderAt('/sessions/1?period=102')

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/1/matches/2'))
    expect(router.state.location.search).toEqual({})
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Match 2 · 15:54 → 16:25'
    )
  })

  it('sends an old link to a linked voice period to its match', async () => {
    const router = renderAt('/sessions/1?period=201')

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/1/matches/1'))
  })

  it('falls back to the session for a period outside any match', async () => {
    const router = renderAt('/sessions/1?period=202')

    await waitFor(() => expect(router.state.location.search).toEqual({}))
    expect(router.state.location.pathname).toBe('/sessions/1')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'VALORANT · 15:40 → 20:14'
    )
  })

  it('says when a match is not in the session', async () => {
    renderAt('/sessions/1/matches/9')

    expect(await screen.findByText('This match is not in the session.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to the session' })).toBeInTheDocument()
  })
  it('adds the timeline of the match when it was measured live', async () => {
    vi.mocked(getMatchRecap).mockResolvedValue(matchRecap())
    renderAt('/sessions/1/matches/2')

    expect(
      await screen.findByRole('region', { name: 'The match, in 30 s slices' })
    ).toBeInTheDocument()
    expect(getMatchRecap).toHaveBeenCalledWith(1, 102)
  })

  it('leaves an older match without a timeline', async () => {
    renderAt('/sessions/1/matches/2')

    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(getMatchRecap).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'View the summary' })).toBeNull()
    expect(document.querySelector('[data-slot=match-timeline]')).toBeNull()
  })

  it('opens the post-match summary from the match', async () => {
    vi.mocked(getMatchRecap).mockResolvedValue(matchRecap())
    const router = renderAt('/sessions/1/matches/2')

    await userEvent.click(await screen.findByRole('button', { name: 'View the summary' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/sessions/1/matches/2/recap'))
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Match 2 ended')
  })
})

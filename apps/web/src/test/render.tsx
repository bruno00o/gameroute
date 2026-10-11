import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouteComponent,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'

export function renderAtRoot(Component: RouteComponent) {
  const rootRoute = createRootRoute({ component: Outlet })
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Component })
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router} />)
}

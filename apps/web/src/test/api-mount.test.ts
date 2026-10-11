import { API_VERSION } from '@gameroute/api'
import { describe, expect, it } from 'vitest'
import { Route } from '@/routes/api/$'

type Handler = (ctx: { request: Request }) => Response | Promise<Response>

const handler = (Route.options.server!.handlers as Record<string, Handler>).ANY

describe('api mount', () => {
  it('forwards /api/health to the Hono app', async () => {
    const res = await handler({ request: new Request('https://gameroute.test/api/health') })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: API_VERSION })
  })

  it('serves the OpenAPI document', async () => {
    const res = await handler({ request: new Request('https://gameroute.test/api/openapi.json') })
    expect(res.status).toBe(200)
    expect((await res.json()).paths).toHaveProperty('/api/health')
  })

  it('answers unknown API paths with a JSON 404', async () => {
    const res = await handler({ request: new Request('https://gameroute.test/api/unknown') })
    expect(res.status).toBe(404)
  })
})

import type { Database } from '@gameroute/db'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { OgWasmLoader } from './og'

export const API_VERSION = '0.1.0'

export type { OgWasm, OgWasmLoader, WasmSource } from './og'

export interface ApiOptions {
  version?: string
  db?: Database
  og?: OgWasmLoader
}

export interface ApiBindings {
  db?: Database
}

const DB_STATUSES = ['ok', 'unavailable', 'not_configured'] as const

type DbStatus = (typeof DB_STATUSES)[number]

const HealthSchema = z
  .object({
    ok: z.boolean(),
    version: z.string().openapi({ example: API_VERSION }),
    db: z.enum(DB_STATUSES),
    dbLatencyMs: z.number().optional(),
  })
  .openapi('Health')

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Service health',
  responses: {
    200: {
      description: 'The API is up',
      content: { 'application/json': { schema: HealthSchema } },
    },
    503: {
      description: 'The database is unreachable',
      content: { 'application/json': { schema: HealthSchema } },
    },
  },
})

async function checkDb(db: Database | undefined): Promise<{ db: DbStatus; dbLatencyMs?: number }> {
  if (!db) return { db: 'not_configured' }
  const start = performance.now()
  try {
    await db.execute('select 1')
    return { db: 'ok', dbLatencyMs: Math.round(performance.now() - start) }
  } catch {
    return { db: 'unavailable' }
  }
}

const IMMUTABLE = 'public, max-age=31536000, immutable'
const SHORT_LIVED = 'public, max-age=3600, s-maxage=86400'

export function createApp({ version = API_VERSION, db, og }: ApiOptions = {}) {
  const app = new OpenAPIHono<{ Bindings: ApiBindings | undefined }>().basePath('/api')

  app.openapi(healthRoute, async c => {
    const status = await checkDb(c.env?.db ?? db)
    if (status.db === 'unavailable') return c.json({ ok: false, version, ...status }, 503)
    return c.json({ ok: true, version, ...status }, 200)
  })

  if (og) {
    app.get('/og/demo.png', async c => {
      const { demoCard, renderPng } = await import('./og')
      const png = await renderPng(demoCard(), og)
      return c.body(png, 200, {
        'Content-Type': 'image/png',
        'Cache-Control': c.req.query('v') ? IMMUTABLE : SHORT_LIVED,
      })
    })
  }

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'GameRoute API', version },
  })

  app.notFound(c => c.json({ ok: false, error: 'not_found' }, 404))

  return app
}

export type ApiApp = ReturnType<typeof createApp>

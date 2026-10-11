import type { Database } from '@gameroute/db'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

export const API_VERSION = '0.1.0'

export interface ApiOptions {
  version?: string
  db?: Database
}

const DB_STATUSES = ['ok', 'unavailable', 'not_configured'] as const

type DbStatus = (typeof DB_STATUSES)[number]

const HealthSchema = z
  .object({
    ok: z.boolean(),
    version: z.string().openapi({ example: API_VERSION }),
    db: z.enum(DB_STATUSES),
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

async function checkDb(db: Database | undefined): Promise<DbStatus> {
  if (!db) return 'not_configured'
  try {
    await db.execute('select 1')
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

export function createApp({ version = API_VERSION, db }: ApiOptions = {}) {
  const app = new OpenAPIHono().basePath('/api')

  app.openapi(healthRoute, async c => {
    const status = await checkDb(db)
    if (status === 'unavailable') return c.json({ ok: false, version, db: status }, 503)
    return c.json({ ok: true, version, db: status }, 200)
  })

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'GameRoute API', version },
  })

  app.notFound(c => c.json({ ok: false, error: 'not_found' }, 404))

  return app
}

export type ApiApp = ReturnType<typeof createApp>

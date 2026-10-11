import { type Database, findReport } from '@gameroute/db'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { HTTPException } from 'hono/http-exception'
import type { OgWasmLoader } from './og'
import { buildOgReport, ogLang } from './og-report'
import { ogCacheKey, registerReports } from './reports'
import type { ApiEnv, ApiServices } from './types'

export const API_VERSION = '0.1.0'

export { REPORT_ID_PATTERN } from './tokens'

export type { OgWasm, OgWasmLoader, WasmSource } from './og'
export type {
  ApiBindings,
  ApiServices,
  RateLimiter,
  RateLimits,
  ResponseCache,
} from './types'

export interface ApiOptions extends ApiServices {
  version?: string
  og?: OgWasmLoader
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
const REPORT_IMAGE_MAX_AGE = 86_400
const REPORT_IMAGE_S_MAXAGE = 604_800
const OG_FILE = /^([0-9A-Za-z]{16,64})\.png$/

function reportImageCacheControl(expiresAt: Date): string {
  const left = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  const maxAge = Math.min(REPORT_IMAGE_MAX_AGE, left)
  const sMaxAge = Math.min(REPORT_IMAGE_S_MAXAGE, left)
  return `public, max-age=${maxAge}, s-maxage=${sMaxAge}`
}

export function createApp({ version = API_VERSION, og, ...services }: ApiOptions = {}) {
  const app = new OpenAPIHono<ApiEnv>({
    defaultHook: (result, c) => {
      if (result.success) return
      if (result.target === 'json') {
        const issues = result.error.issues.map(({ code, path, message }) => ({
          code,
          path: path.map(key => (typeof key === 'number' ? key : String(key))),
          message,
        }))
        return c.json({ error: 'invalid_report', issues }, 400)
      }
      return c.json({ error: 'not_found' }, 404)
    },
  }).basePath('/api')

  app.use(async (c, next) => {
    c.set('services', {
      db: c.env?.db ?? services.db,
      limits: c.env?.limits ?? services.limits,
      cache: c.env?.cache ?? services.cache,
    })
    await next()
  })

  app.openapi(healthRoute, async c => {
    const status = await checkDb(c.var.services.db)
    if (status.db === 'unavailable') return c.json({ ok: false, version, ...status }, 503)
    return c.json({ ok: true, version, ...status }, 200)
  })

  registerReports(app)

  if (og) {
    app.get('/og/demo.png', async c => {
      const { demoCard, renderPng } = await import('./og')
      const png = await renderPng(demoCard(), og)
      return c.body(png, 200, {
        'Content-Type': 'image/png',
        'Cache-Control': c.req.query('v') ? IMMUTABLE : SHORT_LIVED,
      })
    })

    app.get('/og/r/:file', async c => {
      const id = OG_FILE.exec(c.req.param('file'))?.[1]
      if (!id) return c.json({ error: 'not_found' }, 404)
      const { db, cache } = c.var.services
      const lang = ogLang(c.req.query('lang'))
      const key = ogCacheKey(new URL(c.req.url).origin, id, lang)
      const cached = await cache?.match(key)
      if (cached) return cached
      if (!db) return c.json({ error: 'unavailable' }, 503)
      const report = await findReport(db, id)
      if (!report) return c.json({ error: 'not_found' }, 404)
      const { renderPng, reportCard } = await import('./og')
      const png = await renderPng(reportCard(buildOgReport(report.payload, lang)), og)
      const response = new Response(png, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': reportImageCacheControl(report.expiresAt),
        },
      })
      await cache?.put(key, response.clone())
      return response
    })
  }

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'GameRoute API', version },
  })

  app.notFound(c => c.json({ ok: false, error: 'not_found' }, 404))

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      if (error.status === 400) {
        const issues = [{ code: 'invalid_json', path: [], message: error.message }]
        return c.json({ error: 'invalid_report', issues }, 400)
      }
      if (error.status === 415) return c.json({ error: 'unsupported_media_type' }, 415)
      return error.getResponse()
    }
    console.error(error)
    return c.json({ error: 'internal_error' }, 500)
  })

  return app
}

export type ApiApp = ReturnType<typeof createApp>

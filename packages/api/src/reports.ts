import { deleteReport, findReport, findReportDeleteHash, insertReport } from '@gameroute/db'
import { MAX_REPORT_BYTES, REPORT_TTL_DAYS, reportPayloadSchema } from '@gameroute/shared'
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { OG_LANGS, type OgLang } from './og-report'
import {
  createDeleteToken,
  createReportId,
  REPORT_ID_PATTERN,
  sha256Hex,
  timingSafeEqual,
} from './tokens'
import type { ApiEnv, RateLimits } from './types'

const ReportPayloadSchema = reportPayloadSchema.meta({ id: 'ReportPayload' })

const ErrorSchema = z.object({ error: z.string() }).openapi('Error')

const InvalidReportSchema = z
  .object({
    error: z.literal('invalid_report'),
    issues: z.array(
      z.object({
        code: z.string(),
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      })
    ),
  })
  .openapi('InvalidReport')

const CreatedReportSchema = z
  .object({
    id: z.string().openapi({ example: '4fK9qTz2LmV8xR1sNc7HbQ' }),
    url: z.url().openapi({ example: 'https://gameroute.app/r/4fK9qTz2LmV8xR1sNc7HbQ' }),
    deleteToken: z.string().openapi({ description: 'Keep it: only its hash is stored.' }),
    expiresAt: z.iso.datetime(),
  })
  .openapi('CreatedReport')

const ReportSchema = z
  .object({
    id: z.string(),
    payload: ReportPayloadSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .openapi('Report')

const IdParams = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: '4fK9qTz2LmV8xR1sNc7HbQ' }),
})

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errors = {
  404: json(ErrorSchema, 'Unknown or expired report'),
  429: json(ErrorSchema, 'Too many requests'),
  503: json(ErrorSchema, 'The database is not configured'),
}

function rateLimit(kind: keyof RateLimits): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const limiter = c.var.services.limits?.[kind]
    if (limiter) {
      const { success } = await limiter.limit({
        key: c.req.header('cf-connecting-ip') ?? 'unknown',
      })
      if (!success) return c.json({ error: 'rate_limited' }, 429)
    }
    await next()
  }
}

const limitBody = bodyLimit({
  maxSize: MAX_REPORT_BYTES,
  onError: c => c.json({ error: 'payload_too_large' }, 413),
})

const createReportRoute = createRoute({
  method: 'post',
  path: '/reports',
  tags: ['reports'],
  summary: 'Share a report',
  description: `Stores a report for ${REPORT_TTL_DAYS} days and returns its public link and delete token. Bodies over ${MAX_REPORT_BYTES} bytes are refused.`,
  middleware: [rateLimit('create'), limitBody] as const,
  request: {
    body: { required: true, content: { 'application/json': { schema: ReportPayloadSchema } } },
  },
  responses: {
    201: json(CreatedReportSchema, 'The report is stored'),
    400: json(InvalidReportSchema, 'The payload does not match the report schema'),
    413: json(ErrorSchema, 'The body is too large'),
    415: json(ErrorSchema, 'The body is not JSON'),
    429: errors[429],
    503: errors[503],
  },
})

const getReportRoute = createRoute({
  method: 'get',
  path: '/reports/{id}',
  tags: ['reports'],
  summary: 'Read a shared report',
  request: { params: IdParams },
  responses: {
    200: json(ReportSchema, 'The report'),
    404: errors[404],
    503: errors[503],
  },
})

const deleteReportRoute = createRoute({
  method: 'delete',
  path: '/reports/{id}',
  tags: ['reports'],
  summary: 'Delete a shared report',
  security: [{ deleteToken: [] }],
  middleware: [rateLimit('delete')] as const,
  request: { params: IdParams },
  responses: {
    204: { description: 'The report is deleted' },
    401: json(ErrorSchema, 'No bearer token'),
    403: json(ErrorSchema, 'Wrong delete token'),
    404: errors[404],
    429: errors[429],
    503: errors[503],
  },
})

export function ogCacheKey(origin: string, id: string, lang: OgLang): string {
  return `${origin}/api/og/r/${id}.png${lang === 'fr' ? '' : `?lang=${lang}`}`
}

export function registerReports(app: OpenAPIHono<ApiEnv>) {
  app.openAPIRegistry.registerComponent('securitySchemes', 'deleteToken', {
    type: 'http',
    scheme: 'bearer',
    description: 'The deleteToken returned when the report was created.',
  })

  app.openapi(createReportRoute, async c => {
    const { db } = c.var.services
    if (!db) return c.json({ error: 'unavailable' }, 503)
    const payload = c.req.valid('json')
    const id = createReportId()
    const deleteToken = createDeleteToken()
    const stored = await insertReport(db, {
      id,
      payload,
      deleteTokenHash: await sha256Hex(deleteToken),
    })
    const url = `${new URL(c.req.url).origin}/r/${id}`
    return c.json({ id, url, deleteToken, expiresAt: stored.expiresAt.toISOString() }, 201)
  })

  app.openapi(getReportRoute, async c => {
    const { db } = c.var.services
    if (!db) return c.json({ error: 'unavailable' }, 503)
    const { id } = c.req.valid('param')
    const report = REPORT_ID_PATTERN.test(id) ? await findReport(db, id) : undefined
    if (!report) return c.json({ error: 'not_found' }, 404)
    return c.json(
      {
        id: report.id,
        payload: report.payload,
        createdAt: report.createdAt.toISOString(),
        expiresAt: report.expiresAt.toISOString(),
      },
      200
    )
  })

  app.openapi(deleteReportRoute, async c => {
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1]
    if (!token) return c.json({ error: 'unauthorized' }, 401)
    const { db, cache } = c.var.services
    if (!db) return c.json({ error: 'unavailable' }, 503)
    const { id } = c.req.valid('param')
    const hash = REPORT_ID_PATTERN.test(id) ? await findReportDeleteHash(db, id) : undefined
    if (!hash) return c.json({ error: 'not_found' }, 404)
    if (!timingSafeEqual(hash, await sha256Hex(token))) return c.json({ error: 'forbidden' }, 403)
    await deleteReport(db, id)
    if (cache) {
      const origin = new URL(c.req.url).origin
      await Promise.allSettled(OG_LANGS.map(lang => cache.delete(ogCacheKey(origin, id, lang))))
    }
    return c.body(null, 204)
  })
}

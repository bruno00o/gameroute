import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'

export const API_VERSION = '0.1.0'

export interface ApiOptions {
  version?: string
}

const HealthSchema = z
  .object({
    ok: z.literal(true),
    version: z.string().openapi({ example: API_VERSION }),
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
  },
})

export function createApp({ version = API_VERSION }: ApiOptions = {}) {
  const app = new OpenAPIHono().basePath('/api')

  app.openapi(healthRoute, c => c.json({ ok: true as const, version }, 200))

  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'GameRoute API', version },
  })

  app.notFound(c => c.json({ ok: false, error: 'not_found' }, 404))

  return app
}

export type ApiApp = ReturnType<typeof createApp>

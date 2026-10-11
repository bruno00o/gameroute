import { createDb } from '@gameroute/db'
import { afterAll, describe, expect, it } from 'vitest'
import { API_VERSION, createApp } from './index'

describe('api', () => {
  it('reports health with the API version', async () => {
    const res = await createApp().request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: API_VERSION, db: 'not_configured' })
  })

  it('uses the version it is given', async () => {
    const res = await createApp({ version: '9.9.9' }).request('/api/health')
    expect(await res.json()).toEqual({ ok: true, version: '9.9.9', db: 'not_configured' })
  })

  it('reports an unreachable database', async () => {
    const db = createDb('postgres://gameroute:gameroute@127.0.0.1:1/gameroute')
    const res = await createApp({ db }).request('/api/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, version: API_VERSION, db: 'unavailable' })
    await db.$client.end()
  })

  it('serves an OpenAPI document listing the health route', async () => {
    const res = await createApp().request('/api/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      info: unknown
      paths: Record<string, unknown>
    }
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toEqual({ title: 'GameRoute API', version: API_VERSION })
    expect(Object.keys(doc.paths)).toEqual(['/api/health'])
  })

  it('answers unknown routes with a JSON 404', async () => {
    const res = await createApp().request('/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: 'not_found' })
  })
})

describe.skipIf(!process.env.DATABASE_URL)('api with a database', () => {
  const db = createDb(process.env.DATABASE_URL ?? '')

  afterAll(() => db.$client.end())

  it('reports a reachable database', async () => {
    const res = await createApp({ db }).request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: API_VERSION, db: 'ok' })
  })
})

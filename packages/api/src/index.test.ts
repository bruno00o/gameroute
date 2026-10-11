import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createDb, type Database } from '@gameroute/db'
import { afterAll, describe, expect, it } from 'vitest'
import { API_VERSION, createApp } from './index'

const fakeDb = (execute: () => Promise<unknown>) => ({ execute }) as unknown as Database

const resolve = createRequire(import.meta.url).resolve

const loadWasm = async () => ({
  layout: await readFile(resolve('satori/yoga.wasm')),
  resvg: await readFile(resolve('@resvg/resvg-wasm/index_bg.wasm')),
})

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

  it('reports a reachable database with its latency', async () => {
    const res = await createApp({ db: fakeDb(async () => []) }).request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      version: API_VERSION,
      db: 'ok',
      dbLatencyMs: expect.any(Number),
    })
  })

  it('prefers the database bound to the request', async () => {
    const app = createApp({ db: fakeDb(() => Promise.reject(new Error('down'))) })
    const res = await app.request('/api/health', {}, { db: fakeDb(async () => []) })
    expect(res.status).toBe(200)
  })

  it('reports a failing database', async () => {
    const db = fakeDb(() => Promise.reject(new Error('down')))
    const res = await createApp({ db }).request('/api/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, version: API_VERSION, db: 'unavailable' })
  })

  it('reports an unreachable database', async () => {
    const db = createDb('postgres://gameroute:gameroute@127.0.0.1:1/gameroute')
    const res = await createApp({ db }).request('/api/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, version: API_VERSION, db: 'unavailable' })
    await db.$client.end()
  })

  it('renders the demo Open Graph card as a PNG', async () => {
    const res = await createApp({ og: loadWasm }).request('/api/og/demo.png')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toMatch(/^public, /)
    const png = new Uint8Array(await res.arrayBuffer())
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(png.buffer)
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630])
  })

  it('renders the site Open Graph card in each language', async () => {
    const app = createApp({ og: loadWasm })
    const pngs = await Promise.all(
      ['fr', 'en', 'es'].map(async lang => {
        const res = await app.request(`/api/og/site.png?lang=${lang}`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('image/png')
        return Buffer.from(await res.arrayBuffer()).toString('base64')
      })
    )
    expect(new Set(pngs).size).toBe(3)
  })

  it('marks versioned Open Graph URLs immutable', async () => {
    const res = await createApp({ og: loadWasm }).request('/api/og/demo.png?v=1')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  it('has no Open Graph route without wasm', async () => {
    const res = await createApp().request('/api/og/demo.png')
    expect(res.status).toBe(404)
  })

  it('serves an OpenAPI document listing the routes', async () => {
    const res = await createApp().request('/api/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      info: unknown
      paths: Record<string, unknown>
    }
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toEqual({ title: 'GameRoute API', version: API_VERSION })
    expect(Object.keys(doc.paths)).toEqual(['/api/health', '/api/reports', '/api/reports/{id}'])
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
    expect(await res.json()).toEqual({
      ok: true,
      version: API_VERSION,
      db: 'ok',
      dbLatencyMs: expect.any(Number),
    })
  })
})

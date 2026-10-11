import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Database } from '@gameroute/db'
import { createTestDatabase, type TestDatabase } from '@gameroute/db/testing'
import { MAX_REPORT_BYTES, type ReportPayload } from '@gameroute/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleReport } from './fixtures'
import { createApp, type ApiOptions, type ResponseCache } from './index'
import { buildOgReport } from './og-report'
import { createDeleteToken, createReportId, sha256Hex } from './tokens'

const resolve = createRequire(import.meta.url).resolve

const loadWasm = async () => ({
  layout: await readFile(resolve('satori/yoga.wasm')),
  resvg: await readFile(resolve('@resvg/resvg-wasm/index_bg.wasm')),
})

const ORIGIN = 'https://gameroute.test'

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return app.request(`${ORIGIN}/api/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function remove(app: ReturnType<typeof createApp>, id: string, token?: string) {
  return app.request(`${ORIGIN}/api/reports/${id}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

function mutate(change: (report: ReportPayload) => void): ReportPayload {
  const report = sampleReport()
  change(report)
  return report
}

class MemoryCache implements ResponseCache {
  entries = new Map<string, Response>()

  async match(key: string) {
    return this.entries.get(key)?.clone()
  }

  async put(key: string, response: Response) {
    this.entries.set(key, response)
  }

  async delete(key: string) {
    return this.entries.delete(key)
  }
}

const invalidReports: [string, unknown][] = [
  [
    'a private hop address',
    mutate(report => {
      report.matches[0].route!.hops[2].ip = '192.168.1.1'
    }),
  ],
  [
    'an address on a home hop',
    mutate(report => {
      report.matches[0].route!.hops[0].ip = '8.8.8.8'
    }),
  ],
  [
    'an unrounded time without exact times',
    mutate(report => {
      report.matches[0].startedAt = '2026-10-11T20:13:00+02:00'
    }),
  ],
  ['an unknown field', { ...sampleReport(), hostname: 'box.home' }],
  ['an unknown game', { ...sampleReport(), gameSlug: 'minecraft' }],
]

describe('reports without a database', () => {
  it.each(invalidReports)('refuses %s', async (_, body) => {
    const res = await post(createApp(), body)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string; issues: unknown[] }
    expect(json.error).toBe('invalid_report')
    expect(json.issues.length).toBeGreaterThan(0)
  })

  it('refuses malformed JSON', async () => {
    const res = await post(createApp(), '{"version":')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_report' })
  })

  it('refuses bodies over the size limit before parsing them', async () => {
    const res = await post(createApp(), `"${'x'.repeat(MAX_REPORT_BYTES)}"`)
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
  })

  it('answers 503 for a valid report when no database is configured', async () => {
    const res = await post(createApp(), sampleReport())
    expect(res.status).toBe(503)
  })

  it('rate limits by client address without storing it', async () => {
    const keys: string[] = []
    const limits: ApiOptions['limits'] = {
      create: {
        limit: async ({ key }) => {
          keys.push(key)
          return { success: false }
        },
      },
    }
    const res = await post(createApp({ limits }), sampleReport(), {
      'CF-Connecting-IP': '203.0.113.9',
    })
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(keys).toEqual(['203.0.113.9'])
  })

  it('asks for a bearer token to delete', async () => {
    const res = await remove(createApp(), createReportId())
    expect(res.status).toBe(401)
  })

  it('documents the report routes', async () => {
    const res = await createApp().request('/api/openapi.json')
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, unknown>>
      components: { schemas: Record<string, unknown> }
    }
    expect(Object.keys(doc.paths['/api/reports'])).toEqual(['post'])
    expect(Object.keys(doc.paths['/api/reports/{id}']).sort()).toEqual(['delete', 'get'])
    expect(doc.components.schemas).toHaveProperty('ReportPayload')
  })
})

describe('report tokens', () => {
  it('creates 22-character base62 ids', () => {
    const ids = new Set(Array.from({ length: 200 }, createReportId))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{22}$/)
  })

  it('creates 32-byte base64url delete tokens', () => {
    expect(createDeleteToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('hashes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

describe('report Open Graph card', () => {
  it('describes the route by zone with the silent destination', () => {
    const card = buildOgReport(sampleReport(), 'fr')
    expect(card.verdict).toBe(
      'Le problème se situe dans le transit, pas chez vous ni chez votre FAI.'
    )
    expect(card.game).toBe('VALORANT, 2 parties, SFR')
    expect(card.culprit).toBe('transit')
    expect(card.hops).toEqual([
      { zone: 'home', label: 'Domicile', detail: '+1 ms' },
      { zone: 'isp', label: 'SFR', detail: '+8 ms' },
      { zone: 'transit', label: 'Cogent', detail: '+32 ms' },
      { zone: 'service', label: 'Riot Games', detail: 'ne répond pas aux pings', silent: true },
    ])
  })

  it('speaks about the player to an ISP', () => {
    const report = mutate(r => {
      r.recipient = 'isp'
    })
    expect(buildOgReport(report, 'en').verdict).toBe(
      'The problem is in transit, not at the player’s home or their ISP.'
    )
  })
})

describe.skipIf(!process.env.DATABASE_URL)('reports with a database', () => {
  let testDb: TestDatabase | undefined
  let db: Database
  const cache = new MemoryCache()
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    testDb = await createTestDatabase(process.env.DATABASE_URL!)
    db = testDb.db
    app = createApp({ db, cache, og: loadWasm })
  })

  afterAll(() => testDb?.drop())

  async function create() {
    const res = await post(app, sampleReport())
    expect(res.status).toBe(201)
    return (await res.json()) as { id: string; url: string; deleteToken: string; expiresAt: string }
  }

  const expire = (id: string) =>
    db.$client.query("update reports set expires_at = now() - interval '1 minute' where id = $1", [
      id,
    ])

  it('stores a report and returns its link and delete token', async () => {
    const created = await create()
    expect(created.id).toMatch(/^[0-9A-Za-z]{22}$/)
    expect(created.url).toBe(`${ORIGIN}/r/${created.id}`)
    expect(created.deleteToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const days = (new Date(created.expiresAt).getTime() - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(90)

    const { rows } = await db.$client.query(
      'select delete_token_hash, game_slug, exact_times from reports where id = $1',
      [created.id]
    )
    expect(rows[0]).toEqual({
      delete_token_hash: await sha256Hex(created.deleteToken),
      game_slug: 'valorant',
      exact_times: false,
    })
  })

  it('reads a report back', async () => {
    const { id, expiresAt } = await create()
    const res = await app.request(`/api/reports/${id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id,
      payload: sampleReport(),
      createdAt: expect.any(String),
      expiresAt,
    })
  })

  it('answers 404 for unknown and malformed ids', async () => {
    for (const id of [createReportId(), 'short', 'not-base62-but-long-enough']) {
      const res = await app.request(`/api/reports/${id}`)
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
  })

  it('deletes a report only with its token', async () => {
    const { id, deleteToken } = await create()
    expect((await remove(app, id, createDeleteToken())).status).toBe(403)
    expect((await app.request(`/api/reports/${id}`)).status).toBe(200)

    const res = await remove(app, id, deleteToken)
    expect(res.status).toBe(204)
    expect((await app.request(`/api/reports/${id}`)).status).toBe(404)
    expect((await remove(app, id, deleteToken)).status).toBe(404)
  })

  it('hides expired reports', async () => {
    const { id, deleteToken } = await create()
    await expire(id)
    expect((await app.request(`/api/reports/${id}`)).status).toBe(404)
    expect((await remove(app, id, deleteToken)).status).toBe(404)
    expect((await app.request(`/api/og/r/${id}.png`)).status).toBe(404)
  })

  it('renders, caches and forgets the report card', async () => {
    const { id, deleteToken } = await create()
    const res = await app.request(`${ORIGIN}/api/og/r/${id}.png`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400, s-maxage=604800')
    const png = new Uint8Array(await res.arrayBuffer())
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(png.buffer)
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630])

    const key = `${ORIGIN}/api/og/r/${id}.png`
    expect(cache.entries.has(key)).toBe(true)
    await app.request(`${ORIGIN}/api/og/r/${id}.png?lang=en`)
    expect(cache.entries.has(`${key}?lang=en`)).toBe(true)

    expect((await remove(app, id, deleteToken)).status).toBe(204)
    expect(cache.entries.has(key)).toBe(false)
    expect(cache.entries.has(`${key}?lang=en`)).toBe(false)
  })

  it('answers 404 for the card of an unknown report', async () => {
    const res = await app.request(`/api/og/r/${createReportId()}.png`)
    expect(res.status).toBe(404)
  })
})

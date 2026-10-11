import { describe, expect, it } from 'vitest'
import { API_VERSION, createApp } from './index'

describe('api', () => {
  it('reports health with the API version', async () => {
    const res = await createApp().request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: API_VERSION })
  })

  it('uses the version it is given', async () => {
    const res = await createApp({ version: '9.9.9' }).request('/api/health')
    expect(await res.json()).toEqual({ ok: true, version: '9.9.9' })
  })

  it('serves an OpenAPI document listing the health route', async () => {
    const res = await createApp().request('/api/openapi.json')
    expect(res.status).toBe(200)
    const doc = await res.json()
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

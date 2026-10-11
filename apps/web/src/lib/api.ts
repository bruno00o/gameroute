import { createApp, type ResponseCache } from '@gameroute/api'
import { env } from 'cloudflare:workers'
import { requestDb } from './db'

const app = createApp({ og: () => import('./og-wasm').then(module => module.ogWasm) })

function edgeCache(): ResponseCache | undefined {
  if (typeof caches === 'undefined') return undefined
  return (caches as unknown as { default?: ResponseCache }).default
}

export function handleApi(request: Request) {
  return app.fetch(request, {
    db: requestDb(),
    limits: { create: env.REPORT_CREATE_LIMIT, delete: env.REPORT_DELETE_LIMIT },
    cache: edgeCache(),
  })
}

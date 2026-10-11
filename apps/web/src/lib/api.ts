import { createApp } from '@gameroute/api'
import { createDb } from '@gameroute/db'
import { env } from 'cloudflare:workers'

const app = createApp({ og: () => import('./og-wasm').then(module => module.ogWasm) })

export function handleApi(request: Request) {
  const db = env.HYPERDRIVE ? createDb(env.HYPERDRIVE.connectionString) : undefined
  return app.fetch(request, { db })
}

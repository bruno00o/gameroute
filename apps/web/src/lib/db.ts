import { createDb } from '@gameroute/db'
import { env } from 'cloudflare:workers'

export function requestDb() {
  return env.HYPERDRIVE ? createDb(env.HYPERDRIVE.connectionString) : undefined
}

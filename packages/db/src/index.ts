import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

export const LOCAL_DATABASE_URL = 'postgres://gameroute:gameroute@localhost:5432/gameroute'

export function createDb(connectionString: string) {
  return drizzle({
    connection: { connectionString, connectionTimeoutMillis: 5000 },
    schema,
  })
}

export type Database = ReturnType<typeof createDb>

export { schema }

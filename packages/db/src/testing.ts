import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { createDb, type Database } from './index'

const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

export interface TestDatabase {
  db: Database
  drop: () => Promise<void>
}

export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `gameroute_test_${randomUUID().replaceAll('-', '')}`
  const admin = createDb(adminUrl)
  await admin.execute(sql.raw(`create database ${name}`))
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  const db = createDb(url.toString())
  await migrate(db, { migrationsFolder })

  const drop = async () => {
    await db.$client.end()
    for (let attempt = 0; attempt < 50; attempt++) {
      const { rows } = await admin.execute<{ count: number }>(
        sql`select count(*)::int as count from pg_stat_activity where datname = ${name}`
      )
      if (rows[0]?.count === 0) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    await admin.execute(sql.raw(`drop database if exists ${name}`))
    await admin.$client.end()
  }

  return { db, drop }
}

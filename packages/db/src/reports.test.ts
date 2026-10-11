import type { ReportPayload } from '@gameroute/shared'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from './index'
import {
  deleteReport,
  findReport,
  findReportDeleteHash,
  insertReport,
  purgeExpiredReports,
} from './reports'
import { reports } from './schema'
import { createTestDatabase, type TestDatabase } from './testing'

const adminUrl = process.env.DATABASE_URL

const payload = {
  version: 1,
  appVersion: '0.1.21',
  gameSlug: 'league-of-legends',
  recipient: 'forum',
  exactTimes: true,
  verdict: { status: 'ok', zone: null },
  isp: null,
  matches: [],
} as unknown as ReportPayload

describe.skipIf(!adminUrl)('reports', () => {
  let testDb: TestDatabase | undefined
  let db: Database

  beforeAll(async () => {
    testDb = await createTestDatabase(adminUrl!)
    db = testDb.db
  })

  afterAll(() => testDb?.drop())

  const expire = (id: string) =>
    db
      .update(reports)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(reports.id, id))

  it('stores a report with its game and time precision', async () => {
    const stored = await insertReport(db, {
      id: 'AAAAAAAAAAAAAAAAAAAAA1',
      payload,
      deleteTokenHash: 'a'.repeat(64),
    })
    const [row] = await db.select().from(reports).where(eq(reports.id, stored.id))
    expect(row.gameSlug).toBe('league-of-legends')
    expect(row.exactTimes).toBe(true)
    expect(await findReport(db, stored.id)).toEqual(stored)
    expect(await findReportDeleteHash(db, stored.id)).toBe('a'.repeat(64))
  })

  it('hides expired reports', async () => {
    const { id } = await insertReport(db, {
      id: 'AAAAAAAAAAAAAAAAAAAAA2',
      payload,
      deleteTokenHash: 'b'.repeat(64),
    })
    await expire(id)
    expect(await findReport(db, id)).toBeUndefined()
    expect(await findReportDeleteHash(db, id)).toBeUndefined()
  })

  it('deletes a report', async () => {
    const { id } = await insertReport(db, {
      id: 'AAAAAAAAAAAAAAAAAAAAA3',
      payload,
      deleteTokenHash: 'c'.repeat(64),
    })
    expect(await deleteReport(db, id)).toBe(true)
    expect(await deleteReport(db, id)).toBe(false)
  })

  it('purges only expired reports', async () => {
    await db.delete(reports)
    const kept = await insertReport(db, {
      id: 'AAAAAAAAAAAAAAAAAAAAA4',
      payload,
      deleteTokenHash: 'd'.repeat(64),
    })
    const expired = await insertReport(db, {
      id: 'AAAAAAAAAAAAAAAAAAAAA5',
      payload,
      deleteTokenHash: 'e'.repeat(64),
    })
    await expire(expired.id)

    expect(await purgeExpiredReports(db)).toBe(1)
    const ids = (await db.select({ id: reports.id }).from(reports)).map(row => row.id)
    expect(ids).toEqual([kept.id])
  })
})

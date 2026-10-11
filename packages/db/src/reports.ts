import type { ReportPayload } from '@gameroute/shared'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import type { Database } from './index'
import { reports } from './schema'

export interface StoredReport {
  id: string
  payload: ReportPayload
  createdAt: Date
  expiresAt: Date
}

export interface NewReport {
  id: string
  payload: ReportPayload
  deleteTokenHash: string
}

const active = (id: string) => and(eq(reports.id, id), gt(reports.expiresAt, sql`now()`))

export async function insertReport(
  db: Database,
  { id, payload, deleteTokenHash }: NewReport
): Promise<StoredReport> {
  const [row] = await db
    .insert(reports)
    .values({
      id,
      payload,
      gameSlug: payload.gameSlug,
      deleteTokenHash,
      exactTimes: payload.exactTimes,
    })
    .returning({
      id: reports.id,
      createdAt: reports.createdAt,
      expiresAt: reports.expiresAt,
    })
  return { ...row, payload }
}

export async function findReport(db: Database, id: string): Promise<StoredReport | undefined> {
  const [row] = await db
    .select({
      id: reports.id,
      payload: reports.payload,
      createdAt: reports.createdAt,
      expiresAt: reports.expiresAt,
    })
    .from(reports)
    .where(active(id))
  return row ? { ...row, payload: row.payload as ReportPayload } : undefined
}

export async function findReportDeleteHash(db: Database, id: string): Promise<string | undefined> {
  const [row] = await db.select({ hash: reports.deleteTokenHash }).from(reports).where(active(id))
  return row?.hash
}

export async function deleteReport(db: Database, id: string): Promise<boolean> {
  const rows = await db.delete(reports).where(eq(reports.id, id)).returning({ id: reports.id })
  return rows.length > 0
}

export async function purgeExpiredReports(db: Database): Promise<number> {
  const result = await db.delete(reports).where(lt(reports.expiresAt, sql`now()`))
  return result.rowCount ?? 0
}

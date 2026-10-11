import { REPORT_ID_PATTERN } from '@gameroute/api'
import { findReport } from '@gameroute/db'
import { getRequestUrl } from '@tanstack/react-start/server'
import type { SharedReport } from '@/components/report/ReportView'
import { requestDb } from './db'

export interface LoadedReport {
  origin: string
  report: SharedReport | null
}

export async function loadReport(id: string): Promise<LoadedReport> {
  const origin = getRequestUrl().origin
  const db = requestDb()
  if (!db || !REPORT_ID_PATTERN.test(id)) return { origin, report: null }
  const stored = await findReport(db, id)
  if (!stored) return { origin, report: null }
  return {
    origin,
    report: {
      id: stored.id,
      payload: stored.payload,
      createdAt: stored.createdAt.toISOString(),
      expiresAt: stored.expiresAt.toISOString(),
    },
  }
}

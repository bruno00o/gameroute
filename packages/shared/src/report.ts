import { z } from 'zod'
import { isPublicIp } from './ip'
import { MEASUREMENT_SOURCES, ROUTE_ZONES } from './constants'

export const REPORT_SCHEMA_VERSION = 1
export const MAX_REPORT_MATCHES = 20
export const MAX_ROUTE_SEGMENTS = 32
export const MAX_ROUTE_HOPS = 64
export const MAX_REPORT_BYTES = 64 * 1024

export const SEVERITIES = ['ok', 'watch', 'degraded', 'critical', 'unmeasured'] as const
export const REPORT_RECIPIENTS = ['isp', 'publisher', 'forum'] as const
export const MATCH_REASONS = ['loss', 'ping_over_usual', 'ping_high'] as const

const asn = z.number().int().min(1).max(4_294_967_295)
const ms = z.number().min(0).max(60_000)
const pct = z.number().min(0).max(100)
const name = z.string().trim().min(1).max(80)
const severity = z.enum(SEVERITIES)
const zone = z.enum(ROUTE_ZONES)
const time = z.iso.datetime({ offset: true })
const publicIp = z.union([z.ipv4(), z.ipv6()]).refine(isPublicIp, 'Address is not public')

export const reportHopSchema = z
  .object({
    number: z.number().int().min(1).max(255),
    zone,
    asn: asn.nullable(),
    ip: publicIp.nullable(),
    silent: z.boolean(),
    rttMs: ms.nullable(),
    lossPct: pct.nullable(),
    status: severity.nullable(),
  })
  .strict()
  .refine(hop => hop.zone !== 'home' || hop.ip == null, {
    message: 'Home hops never carry an address',
    path: ['ip'],
  })

export const reportSegmentSchema = z
  .object({
    zone,
    asn: asn.nullable(),
    name: name.nullable(),
    firstHop: z.number().int().min(1).max(255),
    lastHop: z.number().int().min(1).max(255),
    addedMs: z.number().min(-60_000).max(60_000),
    status: severity.nullable(),
  })
  .strict()

export const reportRouteSchema = z
  .object({
    targetIp: publicIp,
    destinationAsn: asn.nullable(),
    destinationName: name.nullable(),
    destinationSilent: z.boolean(),
    lastRespondingHop: z.number().int().min(0).max(255),
    totalMs: ms,
    segments: z.array(reportSegmentSchema).max(MAX_ROUTE_SEGMENTS),
    hops: z.array(reportHopSchema).max(MAX_ROUTE_HOPS),
  })
  .strict()

export const reportMatchSchema = z
  .object({
    number: z.number().int().min(1).max(999),
    startedAt: time,
    durationSecs: z.number().int().min(0).max(86_400),
    status: severity,
    reason: z.enum(MATCH_REASONS).nullable(),
    source: z.enum(MEASUREMENT_SOURCES),
    pingMedianMs: ms.nullable(),
    pingP95Ms: ms.nullable(),
    pingAtLeast: z.boolean(),
    measuredUpToHop: z.number().int().min(1).max(255).nullable(),
    usualPingMs: ms.nullable(),
    lossPct: pct.nullable(),
    jitterMs: ms.nullable(),
    route: reportRouteSchema.nullable(),
  })
  .strict()

export const reportPayloadSchema = z
  .object({
    version: z.literal(REPORT_SCHEMA_VERSION),
    appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    gameSlug: z.string().regex(/^[a-z0-9-]{1,40}$/),
    recipient: z.enum(REPORT_RECIPIENTS),
    exactTimes: z.boolean(),
    verdict: z.object({ status: severity, zone: zone.nullable() }).strict(),
    isp: z.object({ asn: asn.nullable(), name: name.nullable() }).strict().nullable(),
    matches: z.array(reportMatchSchema).min(1).max(MAX_REPORT_MATCHES),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.exactTimes) return
    report.matches.forEach((match, index) => {
      const date = new Date(match.startedAt)
      if (date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Times must be rounded to the hour unless exact times are shared',
          path: ['matches', index, 'startedAt'],
        })
      }
    })
  })

export type ReportHop = z.infer<typeof reportHopSchema>
export type ReportSegment = z.infer<typeof reportSegmentSchema>
export type ReportRoute = z.infer<typeof reportRouteSchema>
export type ReportMatch = z.infer<typeof reportMatchSchema>
export type ReportPayload = z.infer<typeof reportPayloadSchema>
export type ReportSeverity = (typeof SEVERITIES)[number]
export type ReportRecipient = (typeof REPORT_RECIPIENTS)[number]
export type MatchReason = (typeof MATCH_REASONS)[number]

export function roundToHour(iso: string): string {
  const date = new Date(iso)
  date.setUTCMinutes(0, 0, 0)
  return date.toISOString()
}

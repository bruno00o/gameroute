import {
  MAX_ZONE_CELL_RESOLUTION,
  MEASUREMENT_SOURCES,
  REPORT_TTL_DAYS,
  ROUTE_ZONES,
} from '@gameroute/shared'
import { type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const NON_PUBLIC_IP_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
] as const

function isPublicIp(column: AnyPgColumn): SQL {
  const ranges = NON_PUBLIC_IP_RANGES.map(range => `'${range}'::inet`).join(', ')
  return sql`not (${column} <<= any (array[${sql.raw(ranges)}]))`
}

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

const asn = (name: string) => bigint(name, { mode: 'number' })

export const measurementSource = pgEnum('measurement_source', MEASUREMENT_SOURCES)
export const routeZone = pgEnum('route_zone', ROUTE_ZONES)
export const memberRole = pgEnum('member_role', ['owner', 'admin', 'viewer'])
export const asnProofMethod = pgEnum('asn_proof_method', ['email_domain', 'ripe', 'peeringdb'])
export const asnClaimStatus = pgEnum('asn_claim_status', ['pending', 'verified', 'rejected'])

export const installs = pgTable('installs', {
  id: uuid('id').primaryKey(),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  appVersion: text('app_version').notNull(),
  country: char('country', { length: 2 }),
})

export const games = pgTable('games', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
})

export const autonomousSystems = pgTable('autonomous_systems', {
  asn: asn('asn').primaryKey(),
  name: text('name').notNull(),
  country: char('country', { length: 2 }),
})

export const zoneCells = pgTable(
  'zone_cells',
  {
    id: text('id').primaryKey(),
    resolution: smallint('resolution').notNull(),
    country: char('country', { length: 2 }).notNull(),
  },
  t => [
    check(
      'zone_cells_resolution_check',
      sql`${t.resolution} between 0 and ${sql.raw(String(MAX_ZONE_CELL_RESOLUTION))}`
    ),
    index('zone_cells_country_idx').on(t.country),
  ]
)

export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    payload: jsonb('payload').notNull(),
    gameSlug: text('game_slug')
      .notNull()
      .references(() => games.slug),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '${sql.raw(String(REPORT_TTL_DAYS))} days'`),
    deleteTokenHash: text('delete_token_hash').notNull(),
    exactTimes: boolean('exact_times').notNull().default(false),
  },
  t => [
    check('reports_id_length_check', sql`char_length(${t.id}) >= 16`),
    index('reports_expires_at_idx').on(t.expiresAt),
  ]
)

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    installId: uuid('install_id')
      .notNull()
      .references(() => installs.id, { onDelete: 'cascade' }),
    gameSlug: text('game_slug')
      .notNull()
      .references(() => games.slug),
    asn: asn('asn').references(() => autonomousSystems.asn),
    zoneCellId: text('zone_cell_id').references(() => zoneCells.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    verdictCodes: text('verdict_codes').array().notNull().default(sql`'{}'::text[]`),
    pingMedianMs: real('ping_median_ms'),
    pingP95Ms: real('ping_p95_ms'),
    lossPct: real('loss_pct'),
    jitterMs: real('jitter_ms'),
    source: measurementSource('source').notNull(),
    createdAt: createdAt(),
  },
  t => [
    check('matches_time_order_check', sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
    index('matches_game_asn_zone_started_idx').on(t.gameSlug, t.asn, t.zoneCellId, t.startedAt),
    index('matches_asn_started_idx').on(t.asn, t.startedAt),
    index('matches_zone_started_idx').on(t.zoneCellId, t.startedAt),
    index('matches_install_idx').on(t.installId),
  ]
)

export const routes = pgTable(
  'routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    targetIp: inet('target_ip').notNull(),
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
  },
  t => [
    check('routes_target_ip_public_check', isPublicIp(t.targetIp)),
    index('routes_match_idx').on(t.matchId),
    index('routes_target_ip_idx').on(t.targetIp),
  ]
)

export const hops = pgTable(
  'hops',
  {
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    ip: inet('ip'),
    asn: asn('asn').references(() => autonomousSystems.asn),
    rttMs: real('rtt_ms'),
    lossPct: real('loss_pct'),
    zone: routeZone('zone').notNull(),
  },
  t => [
    primaryKey({ columns: [t.routeId, t.position] }),
    check('hops_ip_public_check', sql`${t.ip} is null or ${isPublicIp(t.ip)}`),
    check('hops_position_check', sql`${t.position} > 0`),
    index('hops_asn_idx').on(t.asn),
  ]
)

export const topologyNodes = pgTable(
  'topology_nodes',
  {
    ip: inet('ip').primaryKey(),
    asn: asn('asn').references(() => autonomousSystems.asn),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    check('topology_nodes_ip_public_check', isPublicIp(t.ip)),
    index('topology_nodes_asn_idx').on(t.asn),
  ]
)

export const topologyLinks = pgTable(
  'topology_links',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    fromIp: inet('from_ip')
      .notNull()
      .references(() => topologyNodes.ip),
    toIp: inet('to_ip')
      .notNull()
      .references(() => topologyNodes.ip),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    latencyMs: real('latency_ms'),
    lossPct: real('loss_pct'),
    gameSlug: text('game_slug')
      .notNull()
      .references(() => games.slug),
    zoneCellId: text('zone_cell_id').references(() => zoneCells.id),
  },
  t => [
    check('topology_links_distinct_check', sql`${t.fromIp} <> ${t.toIp}`),
    index('topology_links_edge_observed_idx').on(t.fromIp, t.toIp, t.observedAt),
    index('topology_links_to_idx').on(t.toIp),
    index('topology_links_game_zone_observed_idx').on(t.gameSlug, t.zoneCellId, t.observedAt),
  ]
)

export const organisations = pgTable('organisations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: createdAt(),
})

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRole('role').notNull().default('viewer'),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('members_organisation_email_idx').on(t.organisationId, sql`lower(${t.email})`),
    index('members_email_idx').on(sql`lower(${t.email})`),
  ]
)

export const asnClaims = pgTable(
  'asn_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    asn: asn('asn')
      .notNull()
      .references(() => autonomousSystems.asn),
    proofMethod: asnProofMethod('proof_method').notNull(),
    status: asnClaimStatus('status').notNull().default('pending'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('asn_claims_organisation_asn_idx').on(t.organisationId, t.asn),
    uniqueIndex('asn_claims_verified_asn_idx').on(t.asn).where(sql`${t.status} = 'verified'`),
    check(
      'asn_claims_verified_at_check',
      sql`(${t.status} = 'verified') = (${t.verifiedAt} is not null)`
    ),
  ]
)

export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  t => [
    index('magic_link_tokens_member_idx').on(t.memberId),
    index('magic_link_tokens_expires_at_idx').on(t.expiresAt),
  ]
)

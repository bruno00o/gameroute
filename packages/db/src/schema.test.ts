import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Database } from './index'
import {
  asnClaims,
  autonomousSystems,
  games,
  hops,
  installs,
  matches,
  members,
  organisations,
  reports,
  routes,
  topologyLinks,
  topologyNodes,
  zoneCells,
} from './schema'

const adminUrl = process.env.DATABASE_URL
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))

it.runIf(process.env.CI)('runs against a real database in CI', () => {
  expect(adminUrl).toBeTruthy()
})

describe.skipIf(!adminUrl)('schema', () => {
  const name = `gameroute_test_${randomUUID().replaceAll('-', '')}`
  let admin: Database
  let db: Database

  beforeAll(async () => {
    admin = createDb(adminUrl!)
    await admin.execute(sql.raw(`create database ${name}`))
    const url = new URL(adminUrl!)
    url.pathname = `/${name}`
    db = createDb(url.toString())
    await migrate(db, { migrationsFolder })
  })

  afterAll(async () => {
    await db?.$client.end()
    for (let attempt = 0; attempt < 50; attempt++) {
      const { rows } = await admin.execute<{ count: number }>(
        sql`select count(*)::int as count from pg_stat_activity where datname = ${name}`,
      )
      if (rows[0]?.count === 0) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await admin?.execute(sql.raw(`drop database if exists ${name}`))
    await admin?.$client.end()
  })

  it('stores a match with its anonymised route', async () => {
    await db.insert(games).values({ slug: 'valorant', name: 'VALORANT' })
    await db.insert(autonomousSystems).values([
      { asn: 3215, name: 'Orange', country: 'FR' },
      { asn: 6507, name: 'Riot Games', country: 'US' },
    ])
    await db.insert(zoneCells).values({ id: '851fb467fffffff', resolution: 5, country: 'FR' })
    const [install] = await db
      .insert(installs)
      .values({ id: randomUUID(), appVersion: '0.1.20', country: 'FR' })
      .returning()
    const [match] = await db
      .insert(matches)
      .values({
        installId: install.id,
        gameSlug: 'valorant',
        asn: 3215,
        zoneCellId: '851fb467fffffff',
        startedAt: new Date('2026-10-11T20:00:00Z'),
        endedAt: new Date('2026-10-11T21:00:00Z'),
        verdictCodes: ['isp_loss'],
        pingMedianMs: 18,
        pingP95Ms: 31,
        source: 'game',
      })
      .returning()
    const [route] = await db
      .insert(routes)
      .values({ matchId: match.id, targetIp: '162.249.72.1', measuredAt: match.startedAt })
      .returning()
    await db.insert(hops).values([
      { routeId: route.id, position: 2, ip: '193.253.83.1', asn: 3215, rttMs: 4, zone: 'isp' },
      { routeId: route.id, position: 3, ip: null, zone: 'transit' },
      { routeId: route.id, position: 4, ip: '162.249.72.1', asn: 6507, rttMs: 18, zone: 'service' },
    ])

    const stored = await db.select().from(hops).where(eq(hops.routeId, route.id))
    expect(stored.map(hop => hop.zone)).toEqual(['isp', 'transit', 'service'])
    expect(match.verdictCodes).toEqual(['isp_loss'])

    await db.delete(installs).where(eq(installs.id, install.id))
    expect(await db.select().from(hops).where(eq(hops.routeId, route.id))).toEqual([])
  })

  it('rejects private and CGNAT hops', async () => {
    const [install] = await db
      .insert(installs)
      .values({ id: randomUUID(), appVersion: '0.1.20' })
      .returning()
    const [match] = await db
      .insert(matches)
      .values({
        installId: install.id,
        gameSlug: 'valorant',
        startedAt: new Date(),
        source: 'probe',
      })
      .returning()
    const [route] = await db
      .insert(routes)
      .values({ matchId: match.id, targetIp: '162.249.72.1', measuredAt: new Date() })
      .returning()

    for (const ip of ['192.168.1.1', '10.0.0.1', '100.64.0.1', 'fe80::1']) {
      await expect(
        db.insert(hops).values({ routeId: route.id, position: 1, ip, zone: 'home' })
      ).rejects.toThrow()
    }
  })

  it('refuses zone cells finer than the coarsest allowed resolution', async () => {
    await expect(
      db.insert(zoneCells).values({ id: '861fb467fffffff', resolution: 6, country: 'FR' })
    ).rejects.toThrow()
  })

  it('expires shared reports after 90 days by default', async () => {
    const [report] = await db
      .insert(reports)
      .values({
        id: 'r7Hk2pQ9xLm4Vt8Z',
        payload: { verdict: 'isp' },
        gameSlug: 'valorant',
        deleteTokenHash: 'hash',
      })
      .returning()
    const days = (report.expiresAt.getTime() - report.createdAt.getTime()) / 86_400_000
    expect(Math.round(days)).toBe(90)
    expect(report.exactTimes).toBe(false)
  })

  it('records observed topology links between public nodes', async () => {
    await db.insert(topologyNodes).values([
      { ip: '193.253.83.1', asn: 3215 },
      { ip: '162.249.72.1', asn: 6507 },
    ])
    await db.insert(topologyLinks).values({
      fromIp: '193.253.83.1',
      toIp: '162.249.72.1',
      observedAt: new Date(),
      latencyMs: 14,
      gameSlug: 'valorant',
      zoneCellId: '851fb467fffffff',
    })
    const links = await db.select().from(topologyLinks)
    expect(links).toHaveLength(1)
    expect(links[0].fromIp).toBe('193.253.83.1')
  })

  it('allows only one verified owner per ASN', async () => {
    const [first, second] = await db
      .insert(organisations)
      .values([{ name: 'Orange' }, { name: 'Impostor' }])
      .returning()
    await db
      .insert(members)
      .values({ organisationId: first.id, email: 'Noc@Orange.fr', role: 'owner' })
    await expect(
      db.insert(members).values({ organisationId: first.id, email: 'noc@orange.fr' })
    ).rejects.toThrow()

    await db.insert(asnClaims).values({
      organisationId: first.id,
      asn: 3215,
      proofMethod: 'ripe',
      status: 'verified',
      verifiedAt: new Date(),
    })
    await expect(
      db.insert(asnClaims).values({
        organisationId: second.id,
        asn: 3215,
        proofMethod: 'email_domain',
        status: 'verified',
        verifiedAt: new Date(),
      })
    ).rejects.toThrow()
    await db
      .insert(asnClaims)
      .values({ organisationId: second.id, asn: 3215, proofMethod: 'email_domain' })
  })
})

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import * as schema from './db/schema'

const state = vi.hoisted(() => ({ database: null as any, refresh: vi.fn(async () => true), quote: vi.fn(), mail: vi.fn(), mailConfig: true }))
vi.mock('@/lib/db', () => ({ get db() { return state.database } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/portfolio-context', () => ({ loadOwnedPortfolio: async (userId: string, id: number) => {
  const { portfolio } = await import('./db/schema')
  const { eq, and } = await import('drizzle-orm')
  const [p] = await state.database.select().from(portfolio).where(and(eq(portfolio.id, id), eq(portfolio.userId, userId)))
  if (!p) throw new Error('Unauthorized')
  return p
} }))
vi.mock('@/lib/market-data/sync', () => ({ refreshQuotesIfStale: state.refresh }))
vi.mock('@/lib/market-data/quote', () => ({ getCachedQuote: state.quote }))
vi.mock('@/lib/market-data/lookup', () => ({ createSymbolResolver: async () => (ticker: string) => ticker }))
vi.mock('@/lib/notify/agentmail', () => ({ readMailConfig: () => state.mailConfig ? { apiKey: 'isolated', inboxId: 'isolated' } : null, sendMail: state.mail }))

import { createPlanFxSnapshot, readPlanFxSnapshot } from './fx-service'
import { runAlertCheck, lastAlertCheck } from './alert-run'
import { acquireAlertLease, releaseAlertLease } from './alert-lease'
import { GET as alertRoute } from '../app/api/cron/check-alerts/route'
import { NextRequest } from 'next/server'

let pg: PGlite
const dialect = new PgDialect()
beforeAll(async () => {
  pg = new PGlite(); state.database = drizzle(pg, { schema })
  for (const table of [schema.user, schema.portfolio, schema.trade, schema.stock, schema.priceAlert, schema.quoteSnapshot, schema.userSettings, schema.alertCheckRun]) {
    const config = getTableConfig(table)
    const columns = config.columns.filter(c => !['fxMode', 'fxSnapshotId', 'complete', 'quotesMissing', 'quotesPaused', 'marketState', 'quoteType'].includes(c.name)).map(c => {
      let d = ''
      if (c.default !== undefined) {
        const v = c.default
        d = ' DEFAULT ' + (typeof v === 'string' ? `'${v.replaceAll("'", "''")}'` : typeof v === 'number' || typeof v === 'boolean' ? String(v) : dialect.sqlToQuery(v as any).sql)
      }
      return `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${d}`
    })
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`)
  }
  const migration = readFileSync(new URL('../drizzle/0052_fx_and_alert_health.sql', import.meta.url), 'utf8')
  await state.database.insert(schema.user).values({ id: 'owner', name: 'Isolated', email: 'owner@example.invalid' })
  // Migration must run twice and preserve legacy FX timestamps and trades.
  await pg.exec(`INSERT INTO portfolio (id,"userId",name,currency,"fxRates","fxRatesAt") VALUES (1,'owner','Isolated','EUR','{"USD":0.5}','2020-01-01');
    INSERT INTO trade (id,"userId",ticker,direction,"entryPrice","stopLoss") VALUES (1,'owner','LEGACY','long',100,90);`)
  await pg.exec(migration); await pg.exec(migration)
  const pauseMigration = readFileSync(new URL('../drizzle/0053_alert_feed_pause.sql', import.meta.url), 'utf8')
  await pg.exec(pauseMigration); await pg.exec(pauseMigration)
  const old = await state.database.select().from(schema.portfolio)
  expect(old[0].fxRatesAt.toISOString()).toBe('2020-01-01T00:00:00.000Z')
  const legacy = await state.database.select().from(schema.trade)
  expect(legacy[0].entryPrice).toBe(100); expect(legacy[0].fxSnapshotId).toBeNull()
}, 30000)
afterAll(async () => { vi.unstubAllGlobals(); await pg?.close() })
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  state.mailConfig = true
  state.refresh.mockResolvedValue(true)
  state.quote.mockReset()
  state.quote.mockResolvedValue({ price: 100, high: 101, low: 99, time: Math.floor(Date.now() / 1000), interval: '1h' })
  state.mail.mockReset(); state.mail.mockResolvedValue({ ok: true, messageId: 'isolated' })
  await pg.exec('TRUNCATE stock,price_alert,quote_snapshot,alert_check_run,alert_check_state,alert_mail_delivery,fx_reference_cache,plan_fx_snapshot,user_settings RESTART IDENTITY')
  await state.database.insert(schema.stock).values({ userId: 'owner', ticker: 'ISOLATED', name: 'Isolated', market: 'aktien', providerSymbol: 'ISOLATED', resolutionStatus: 'ok', resolutionApproximate: false })
  await state.database.update(schema.portfolio).set({ currency: 'EUR', fxMode: 'automatic', fxRates: '{"USD":0.5}', fxRatesAt: new Date('2020-01-01') }).where(eq(schema.portfolio.id, 1))
})
async function alert(extra: Record<string, unknown> = {}) {
  const [row] = await state.database.insert(schema.priceAlert).values({ userId: 'owner', ticker: 'ISOLATED', market: 'aktien', price: 110, direction: 'above', kind: 'manuell', ...extra }).returning()
  return row
}
function ecbResponse() {
  const date = new Date().toISOString().slice(0, 10)
  return new Response(`<gesmes:Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><Cube><Cube time='${date}'><Cube currency='USD' rate='1.2'/><Cube currency='GBP' rate='0.8'/></Cube></Cube></gesmes:Envelope>`)
}

describe('FX snapshots on PostgreSQL', () => {
  it('uses one cached fetch, binds snapshots to owner/depot/pair, and keeps exact frozen values', async () => {
    const fetch = vi.fn(async () => ecbResponse()); vi.stubGlobal('fetch', fetch)
    const a = await createPlanFxSnapshot('owner', 1, 'USD')
    const b = await createPlanFxSnapshot('owner', 1, 'GBP')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(a.rate).toBeCloseTo(1 / 1.2); expect(b.rate).toBeCloseTo(1 / 0.8)
    expect(a).not.toHaveProperty('userId')
    const frozen = await readPlanFxSnapshot('owner', 1, a.id, 'USD', 'EUR')
    await state.database.update(schema.portfolio).set({ fxRates: '{"USD":0.9}' }).where(eq(schema.portfolio.id, 1))
    expect(await readPlanFxSnapshot('owner', 1, a.id, 'USD', 'EUR')).toEqual(frozen)
    await expect(readPlanFxSnapshot('other', 1, a.id, 'USD', 'EUR')).rejects.toThrow('gehört nicht')
    await expect(readPlanFxSnapshot('owner', 2, a.id, 'USD', 'EUR')).rejects.toThrow('gehört nicht')
    await expect(readPlanFxSnapshot('owner', 1, a.id, 'GBP', 'EUR')).rejects.toThrow('gehört nicht')
    await expect(createPlanFxSnapshot('other', 1, 'USD')).rejects.toThrow('Unauthorized')
    await state.database.update(schema.planFxSnapshot).set({ referenceAt: new Date('2020-01-01') }).where(eq(schema.planFxSnapshot.id, a.id))
    await expect(readPlanFxSnapshot('owner', 1, a.id, 'USD', 'EUR')).rejects.toThrow('sieben Tagen')
  })
  it('uses a valid cached reference with a warning during outage, never stale values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(createPlanFxSnapshot('owner', 1, 'USD')).rejects.toThrow('konnten nicht geladen')
    await state.database.insert(schema.fxReferenceCache).values({ id: 'ecb', rates: { EUR: 1, USD: 1.2 }, referenceAt: new Date(), fetchedAt: new Date(Date.now() - 7200000) })
    const s = await createPlanFxSnapshot('owner', 1, 'USD')
    expect(s.warning).toContain('noch gültige'); expect(s.source).toBe('ecb')
    await state.database.update(schema.fxReferenceCache).set({ referenceAt: new Date('2020-01-01') }).where(eq(schema.fxReferenceCache.id, 'ecb'))
    await expect(createPlanFxSnapshot('owner', 1, 'USD')).rejects.toThrow('sieben Tagen')
  })
  it('supports explicit manual mode and same-currency without a provider', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline')); vi.stubGlobal('fetch', fetch)
    const same = await createPlanFxSnapshot('owner', 1, 'EUR')
    expect(same.rate).toBe(1); expect(fetch).not.toHaveBeenCalled()
    await state.database.update(schema.portfolio).set({ fxMode: 'manual', fxRates: '{"USD":0.9}', fxRatesAt: new Date() }).where(eq(schema.portfolio.id, 1))
    expect((await createPlanFxSnapshot('owner', 1, 'USD')).source).toBe('manual')
    expect(fetch).not.toHaveBeenCalled()
    await state.database.update(schema.portfolio).set({ fxRatesAt: new Date(Date.now() + 60000) }).where(eq(schema.portfolio.id, 1))
    await expect(createPlanFxSnapshot('owner', 1, 'USD')).rejects.toThrow('Zukunft')
  })
})

describe('bounded alarm checks on PostgreSQL', () => {
  it('rejects overlapping passes and releases the lease for recovery', async () => {
    const lease = await acquireAlertLease(); expect(lease).not.toBeNull()
    expect((await runAlertCheck({ trigger: 'cron' })).busy).toBe(true)
    await releaseAlertLease(lease!.token)
    expect((await runAlertCheck({ trigger: 'cron' })).complete).toBe(true)
  })
  it('does not count client, failed or unfinished attempts as automatic success', async () => {
    await runAlertCheck({ trigger: 'client', userId: 'owner' })
    expect(await lastAlertCheck()).toBeNull()
    await state.database.insert(schema.alertCheckRun).values({ trigger: 'cron' })
    expect(await lastAlertCheck(true)).toBeNull()
    await runAlertCheck({ trigger: 'cron' })
    expect((await lastAlertCheck(true))?.complete).toBe(true)
  })
  it('resumes a pass beyond the batch limit rather than silently skipping later alerts', async () => {
    for (let i = 0; i < 27; i++) await alert()
    const first = await runAlertCheck({ trigger: 'cron' })
    expect(first.complete).toBe(false); expect(first.remaining).toBe(true)
    expect((await state.database.select().from(schema.alertCheckState))[0].cursor).toBe(25)
    const second = await runAlertCheck({ trigger: 'cron' })
    expect(second.complete).toBe(true)
    expect((await state.database.select().from(schema.alertCheckState))[0].cursor).toBe(0)
  })
  it('does not trigger on missing/stale/future prices and recovers on fresh evidence', async () => {
    await alert({ price: 90 })
    state.quote.mockResolvedValue({ price: 100, high: 101, low: 99, time: Math.floor(Date.now() / 1000) - 86400, interval: '1h' })
    await state.database.insert(schema.quoteSnapshot).values({ symbol: 'ISOLATED', provider: 'yahoo', price: 100, quotedAt: Math.floor(Date.now() / 1000) + 100, fetchedAt: new Date() })
    const failed = await runAlertCheck({ trigger: 'cron' })
    expect(failed.complete).toBe(false); expect(failed.quotesMissing).toBe(1)
    expect((await state.database.select().from(schema.priceAlert))[0].triggeredAt).toBeNull()
    expect(await lastAlertCheck(true)).toBeNull()
    state.quote.mockResolvedValue({ price: 100, high: 101, low: 99, time: Math.floor(Date.now() / 1000), interval: '1h' })
    const recovered = await runAlertCheck({ trigger: 'cron' })
    expect(recovered.complete).toBe(true); expect(recovered.triggered).toBe(1); expect(recovered.mailsSent).toBe(1)
  })
  it('records a freshly confirmed regular-feed pause without firing an old closing price', async () => {
    const now=Date.parse('2026-10-14T13:00:00Z')
    vi.spyOn(Date,'now').mockReturnValue(now)
    await alert({price:90})
    await state.database.insert(schema.quoteSnapshot).values({provider:'yahoo',symbol:'ISOLATED',price:100,
      quotedAt:Date.parse('2026-10-13T20:00:00Z')/1000,fetchedAt:new Date(now),marketState:'PRE',quoteType:'EQUITY',exchange:'NYSE'})
    const result=await runAlertCheck({trigger:'cron'})
    expect(result).toMatchObject({complete:true,quotesPaused:1,quotesMissing:0,triggered:0})
    expect(state.quote).not.toHaveBeenCalled()
    expect((await state.database.select().from(schema.priceAlert))[0].triggeredAt).toBeNull()
    expect((await lastAlertCheck(true)).quotesPaused).toBe(1)
    // An outage after regular open must not inherit the earlier PRE exception.
    const opened=Date.parse('2026-10-14T13:31:00Z')
    vi.spyOn(Date,'now').mockReturnValue(opened)
    await state.database.update(schema.quoteSnapshot).set({fetchedAt:new Date(opened)})
    state.quote.mockRejectedValue(new Error('offline'))
    expect(await runAlertCheck({trigger:'cron'})).toMatchObject({complete:false,quotesMissing:1,quotesPaused:0})
  })
  it('does not use another provider snapshot to excuse an unavailable source',async()=>{
    const now=Date.parse('2026-10-14T13:00:00Z')
    vi.spyOn(Date,'now').mockReturnValue(now)
    await alert({price:90})
    state.quote.mockRejectedValue(new Error('offline'))
    await state.database.insert(schema.quoteSnapshot).values({provider:'twelvedata',symbol:'ISOLATED',price:100,
      quotedAt:Date.parse('2026-10-13T20:00:00Z')/1000,fetchedAt:new Date(now),marketState:'PRE',quoteType:'EQUITY',exchange:'NYSE'})
    expect(await runAlertCheck({trigger:'cron'})).toMatchObject({complete:false,quotesMissing:1,quotesPaused:0,triggered:0})
  })
  it('rejects raw ticker, foreign instrument and approximate-source fallbacks', async () => {
    await alert({ price: 90, ticker: 'UNRESOLVED' }); await alert({ price: 90, stockId: 999 })
    await state.database.update(schema.stock).set({ resolutionApproximate: true })
    await alert({ price: 90 })
    const result = await runAlertCheck({ trigger: 'cron' })
    expect(result.quotesMissing).toBe(3); expect(result.triggered).toBe(0)
    expect(state.mail).not.toHaveBeenCalled()
  })
  it('retries the exact persisted delivery with the same idempotency key after a timeout', async () => {
    await alert({ price: 90 })
    state.mail.mockResolvedValueOnce({ ok: false, error: 'timeout' })
    const first = await runAlertCheck({ trigger: 'cron' })
    expect(first.complete).toBe(false); expect(first.mailsFailed).toBe(1)
    const saved = (await state.database.select().from(schema.alertMailDelivery))[0]
    expect(saved.sentAt).toBeNull()
    const second = await runAlertCheck({ trigger: 'cron' })
    expect(second.complete).toBe(true); expect(second.mailsSent).toBe(1)
    expect(state.mail.mock.calls[0][0]).toEqual(state.mail.mock.calls[1][0])
    expect(state.mail.mock.calls[0][2].idempotencyKey).toBe(state.mail.mock.calls[1][2].idempotencyKey)
    await runAlertCheck({ trigger: 'cron' })
    expect(state.mail).toHaveBeenCalledTimes(2)
  })
  it('respects disabled email and never resends an ambiguous delivery older than the provider window', async () => {
    await alert({ price: 90 })
    await state.database.insert(schema.userSettings).values({ userId: 'owner', notifyByEmail: false })
    state.mailConfig = false
    expect((await runAlertCheck({ trigger: 'cron' })).complete).toBe(true)
    expect(state.mail).not.toHaveBeenCalled()
    state.mailConfig = true
    await state.database.update(schema.userSettings).set({ notifyByEmail: true }).where(eq(schema.userSettings.userId, 'owner'))
    await alert({ price: 90 }); state.mail.mockResolvedValueOnce({ ok: false, error: 'timeout' })
    await runAlertCheck({ trigger: 'cron' })
    await state.database.update(schema.alertMailDelivery).set({ createdAt: new Date(Date.now() - 86400000) })
    const before = state.mail.mock.calls.length
    expect((await runAlertCheck({ trigger: 'cron' })).mailsFailed).toBe(1)
    expect(state.mail.mock.calls.length).toBe(before)
  })
  it('continues checking earlier alerts while mail remains unavailable', async () => {
    await alert({ price: 90 }); const later = await alert({ price: 110 })
    state.mailConfig = false
    await runAlertCheck({ trigger: 'cron' })
    expect((await state.database.select().from(schema.alertCheckState))[0].cursor).toBe(0)
    state.quote.mockResolvedValue({ price: 120, high: 121, low: 119, time: Math.floor(Date.now() / 1000), interval: '1h' })
    const second = await runAlertCheck({ trigger: 'cron' })
    expect(second.triggeredIds).toContain(later.id)
  })
  it('does not send a queued delivery to a changed recipient or for a cancelled alarm', async () => {
    const a = await alert({ price: 90 }); state.mail.mockResolvedValueOnce({ ok: false, error: 'timeout' })
    await runAlertCheck({ trigger: 'cron' })
    await state.database.insert(schema.userSettings).values({ userId: 'owner', notifyByEmail: true, notifyEmail: 'changed@example.invalid' })
    const before = state.mail.mock.calls.length
    await runAlertCheck({ trigger: 'cron' })
    expect(state.mail.mock.calls.length).toBe(before)
    await state.database.update(schema.priceAlert).set({ active: false }).where(eq(schema.priceAlert.id, a.id))
    await runAlertCheck({ trigger: 'cron' })
    expect(state.mail.mock.calls.length).toBe(before)
  })
  it('resumes at the next alert after the time budget is reached', async () => {
    await alert(); await alert()
    const start = Date.now(); let clock = start
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    state.quote.mockImplementation(async () => {
      clock = start + 16000
      return { price: 100, high: 101, low: 99, time: Math.floor(start / 1000), interval: '1h' }
    })
    const first = await runAlertCheck({ trigger: 'cron', notify: false })
    expect(first.complete).toBe(false); expect(first.remaining).toBe(true)
    vi.restoreAllMocks()
    expect((await runAlertCheck({ trigger: 'cron', notify: false })).complete).toBe(true)
  })
  it('uses scoped authentication and honest HTTP statuses', async () => {
    vi.stubEnv('ALERT_CRON_SECRET', 'isolated-alarm-secret')
    const req = (token: string) => new NextRequest('http://localhost/api/cron/check-alerts', { headers: { authorization: `Bearer ${token}` } })
    expect((await alertRoute(req('demo-secret'))).status).toBe(401)
    expect((await alertRoute(req('isolated-alarm-secret'))).status).toBe(200)
    const lease = await acquireAlertLease()
    expect((await alertRoute(req('isolated-alarm-secret'))).status).toBe(409)
    await releaseAlertLease(lease!.token)
    await alert(); state.quote.mockRejectedValue(new Error('offline'))
    expect((await alertRoute(req('isolated-alarm-secret'))).status).toBe(503)
    vi.unstubAllEnvs()
  })
})

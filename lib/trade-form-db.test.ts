import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from './db/schema'
import { getContractSpecFor, getTradeFormInstrumentFor } from '../app/actions/stocks'

const state = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: async () => ({ user: { id: 'form-qa' } }) } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
let pg: PGlite
beforeAll(async () => {
  pg = new PGlite()
  state.db = drizzle(pg, { schema })
  // Deliberately no lastReviewedAt: the observed production-compatible schema.
  await pg.exec(`CREATE TABLE stock (id serial PRIMARY KEY, "userId" text, ticker text, market text,
    "contractTickSize" double precision, "contractTickValue" double precision, "contractSize" double precision,
    "contractCurrency" text, "contractMarginModel" text, "contractInitialMargin" double precision,
    "contractMaintenanceMargin" double precision, "contractMaintenanceRate" double precision,
    "contractsDisabled" boolean DEFAULT false, "providerSymbol" text, "resolutionStatus" text, "resolvedCurrency" text);
    INSERT INTO stock ("userId",ticker,market,"contractTickValue","contractCurrency","contractsDisabled","resolutionStatus","resolvedCurrency") VALUES
    ('form-qa','ES1!','rohstoffe',15,'USD',false,null,null),
    ('form-qa','ES2!','rohstoffe',null,null,true,'ok','USD'),
    ('other','NQ1!','rohstoffe',999,'EUR',false,null,null),
    ('form-qa','META','aktien',null,null,false,'ok','USD'),
    ('other','META','aktien',null,null,false,'ok','EUR');`)
}, 30000)
afterAll(async () => { await pg?.close() })
describe('form lookups on a schema without unrelated review metadata', () => {
  it('reads contract overrides without the missing watchlist column', async () => {
    const result = await getTradeFormInstrumentFor('ES1!', 'rohstoffe')
    expect(result.spec?.tickValue).toBe(15)
    expect(result.currency).toBe('USD')
  })
  it('preserves a user-disabled contract', async () => {
    expect(await getTradeFormInstrumentFor('ES2!', 'rohstoffe')).toEqual({ spec: null, currency: 'USD' })
  })
  it('does not read another user’s stock or override', async () => {
    expect(await getContractSpecFor({ stockId: 3 })).toBeNull()
    const result = await getTradeFormInstrumentFor('NQ1!', 'rohstoffe')
    expect(result.spec?.tickValue).toBe(5)
    expect(result.currency).toBe('USD')
  })
  it('resolves ordinary stock currency using only the owner’s row', async () => {
    expect(await getTradeFormInstrumentFor('META', 'aktien')).toEqual({ spec: null, currency: 'USD' })
  })
})

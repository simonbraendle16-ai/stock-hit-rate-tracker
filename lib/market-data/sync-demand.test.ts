import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { stock, trade, symbolSyncRun, quoteSnapshot } from '@/lib/db/schema'
const state = vi.hoisted(() => ({ db: null as any, quotes: vi.fn(), link: vi.fn(), candles: vi.fn() }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('./yahoo', () => ({ getYahooQuotes: state.quotes, getYahooQuoteViaChart: async () => { throw Error('isolated offline') } }))
vi.mock('./candle-store', () => ({ getStoredCandles: state.candles }))
vi.mock('@/lib/link-trades', () => ({ linkLooseTrades: state.link }))
import { runSymbolSync, refreshQuotesIfStale } from './sync'
let pg: PGlite
beforeAll(async () => {
  pg = new PGlite(); state.db = drizzle(pg)
  const dialect = new PgDialect()
  for (const table of [stock, trade, symbolSyncRun, quoteSnapshot]) {
    const config = getTableConfig(table)
    const columns = config.columns.map(c => {
      const v = c.default
      const d = v === undefined ? '' : ' DEFAULT ' + (typeof v === 'string' ? "'" + v.replaceAll("'", "''") + "'" :
        typeof v === 'number' || typeof v === 'boolean' ? String(v) : dialect.sqlToQuery(v as any).sql)
      return `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${d}`
    })
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`)
  }
  await pg.exec('CREATE UNIQUE INDEX quote_key ON quote_snapshot(provider,symbol)')
})
afterAll(async () => { await pg.close() })
beforeEach(async () => {
  await pg.exec('TRUNCATE stock,trade,symbol_sync_run,quote_snapshot RESTART IDENTITY')
  state.link.mockReset().mockResolvedValue({ linked: 0 }); state.candles.mockReset()
  state.quotes.mockReset().mockImplementation(async (symbols: string[]) => new Map(symbols.map(symbol => [symbol,
    { symbol, price: 10, time: Math.floor(Date.now() / 1000), name: symbol, currency: 'USD' }])))
  await state.db.insert(stock).values([
    { id: 1, userId: 'one', ticker: 'AAA', name: 'Synthetic', market: 'aktien', providerSymbol: 'AAA', provider: 'yahoo', resolutionStatus: 'ok' },
    { id: 2, userId: 'two', ticker: 'BBB', name: 'Synthetic', market: 'aktien', providerSymbol: 'BBB', provider: 'yahoo', resolutionStatus: 'ok' },
  ])
})
describe('quote supply demand and scoping', () => {
  it('cron cannot fetch no-trade or planned-only instruments; does not resolve or link trades', async () => {
    expect((await runSymbolSync({ trigger: 'cron' })).quotesUpdated).toBe(0)
    await state.db.insert(trade).values({ id: 1, stockId: 1, userId: 'one', ticker: 'AAA', status: 'geplant' })
    expect((await runSymbolSync({ trigger: 'cron' })).quotesUpdated).toBe(0)
    expect(state.quotes).not.toHaveBeenCalled(); expect(state.link).not.toHaveBeenCalled()
  })
  it('cron updates active symbols once and excludes planned and unrelated watchlists', async () => {
    await state.db.insert(trade).values([
      { id: 1, stockId: 1, userId: 'one', ticker: 'AAA', status: 'aktiv' },
      { id: 2, stockId: 1, userId: 'one', ticker: 'AAA', status: 'aktiv' },
      { id: 3, stockId: 2, userId: 'two', ticker: 'BBB', status: 'geplant' },
    ])
    expect((await runSymbolSync({ trigger: 'cron' })).quotesUpdated).toBe(1)
    expect(state.quotes).toHaveBeenCalledExactlyOnceWith(['AAA'])
    expect(state.link).not.toHaveBeenCalled()
  })
  it('on-demand updates only the caller and never uses a different owners fresh snapshot as global freshness', async () => {
    await state.db.insert(quoteSnapshot).values({ provider: 'yahoo', symbol: 'BBB', price: 10, fetchedAt: new Date() })
    expect(await refreshQuotesIfStale(undefined, 'one')).toBe(true)
    expect(state.quotes).toHaveBeenCalledExactlyOnceWith(['AAA'])
    expect(await refreshQuotesIfStale(undefined, 'one')).toBe(false)
    expect(state.quotes).toHaveBeenCalledTimes(1)
    expect(await refreshQuotesIfStale()).toBe(false)
  })
  it('parallel page demand coalesces and failed sources remain honest', async () => {
    expect(await Promise.all([refreshQuotesIfStale(0, 'one'), refreshQuotesIfStale(0, 'one')])).toEqual([true, true])
    expect(state.quotes).toHaveBeenCalledTimes(1)
    state.quotes.mockRejectedValue(new Error('isolated offline'))
    expect(await refreshQuotesIfStale(0, 'one')).toBe(false)
    expect((await state.db.select().from(quoteSnapshot))[0]).toMatchObject({ price: 10, failCount: 1 })
  })
  it('automatic spot snapshot uses the existing shared automatic candle budget path', async () => {
    await pg.exec(`UPDATE stock SET "providerSymbol"='XAUUSD',provider='twelvedata',market='rohstoffe' WHERE id=1`)
    await state.db.insert(trade).values({ id: 1, stockId: 1, userId: 'one', ticker: 'XAUUSD', status: 'aktiv' })
    state.candles.mockResolvedValue([{ time: Math.floor(Date.now() / 1000), close: 100 }])
    expect((await runSymbolSync({ trigger: 'cron' })).quotesUpdated).toBe(1)
    expect(state.candles).toHaveBeenCalledExactlyOnceWith('XAUUSD', 'rohstoffe', '5min', expect.objectContaining({ automatic: true, provider: 'twelvedata', requireFresh: true }))
  })
})

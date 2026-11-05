import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import { stock, trade, candleSeries, candleCollectRun } from '@/lib/db/schema'

const state = vi.hoisted(() => ({ db: null as any, market: null as any, fetch: vi.fn(), quotes: vi.fn() }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('./candle-store', () => ({ getStoredCandles: state.fetch }))
vi.mock('./sync', () => ({ runSymbolSync: state.quotes }))
import { runCandleCollect, COLLECTED_INTERVALS, claimCollectHour } from './phase1-candle-collect.fixture'
import { activeTradeInstruments } from './active-trade-demand'
import { readFileSync } from 'node:fs'
vi.mock('./database',()=>({get marketDb(){return state.market}}))

import { reserveAutomaticCandles, finishAutomaticCandles } from '../automatic-candles'
let pg: PGlite; let marketPg:PGlite
beforeAll(async () => {
  pg = new PGlite(); state.db = drizzle(pg);marketPg=new PGlite();state.market=drizzle(marketPg)
  await marketPg.exec(readFileSync(new URL('../../drizzle-market/0001_market.sql',import.meta.url),'utf8'))
  const dialect = new PgDialect()
  for (const table of [stock, trade]) {
    const config = getTableConfig(table)
    const columns = config.columns.map(c => {
      const v = c.default
      const d = v === undefined ? '' : ' DEFAULT ' + (typeof v === 'string' ? "'" + v.replaceAll("'", "''") + "'" :
        typeof v === 'number' || typeof v === 'boolean' ? String(v) : dialect.sqlToQuery(v as any).sql)
      return `"${c.name}" ${c.getSQLType()}${c.primary ? ' PRIMARY KEY' : ''}${d}`
    })
    // composite key is created separately below
    await pg.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`)
  }
  await pg.exec('CREATE TABLE background_job_gate(job text PRIMARY KEY,"ranAt" timestamptz NOT NULL)')
  await pg.exec("CREATE TABLE IF NOT EXISTS automatic_candle_budget (\r\n  hour timestamptz PRIMARY KEY,\r\n  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 150)\r\n);\r\nCREATE TABLE IF NOT EXISTS automatic_candle_fetch (\r\n  key text PRIMARY KEY,\r\n  hour timestamptz NOT NULL,\r\n  \"leaseUntil\" timestamptz NOT NULL,\r\n  token uuid NOT NULL,\r\n  since double precision,\r\n  attempts integer NOT NULL DEFAULT 1,\r\n  \"attemptedAt\" timestamptz NOT NULL DEFAULT now(),\r\n  \"completedAt\" timestamptz,\r\n  error text\r\n);\r\nCREATE TABLE IF NOT EXISTS automatic_provider_day (\r\n  provider text NOT NULL,\r\n  day date NOT NULL,\r\n  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 800),\r\n  PRIMARY KEY(provider,day)\r\n);")
})
afterAll(async () => { await pg.close();await marketPg.close() })
beforeEach(async () => {
  await pg.exec('TRUNCATE stock,trade,background_job_gate,automatic_candle_budget,automatic_candle_fetch,automatic_provider_day RESTART IDENTITY')
  await state.db.insert(stock).values({ id: 1, userId: 'synthetic', ticker: 'TEST', name: 'Isolated', market: 'aktien',
    providerSymbol: 'TEST', provider: 'yahoo', resolutionStatus: 'ok' })
  await marketPg.exec('TRUNCATE candle_series,candle_collect_run RESTART IDENTITY')
  state.fetch.mockReset().mockResolvedValue([])
  state.quotes.mockReset().mockResolvedValue({ error: null, quotesFailed: 0 })
})
async function addTrade(id: number, status = 'aktiv', stockId = 1, userId = 'synthetic') {
  await state.db.insert(trade).values({ id, stockId, userId, ticker: 'TEST', name: 'Isolated', status })
}
async function nextHour() { await pg.exec(`UPDATE background_job_gate SET "ranAt"=now()-interval '61 minutes'`) }


describe('phase 1 real shared-reservation diagnosis', () => {
  it.each([true, false])('quote reservation present=%s reproduces conflict with a control', async used => {
    await addTrade(1)
    await state.db.update(stock).set({ provider: 'twelvedata', providerSymbol: 'XAUUSD' })
    const errors: string[] = []
    let upstream = 0
    const fetch = async (symbol: string, market: string, interval: string) => {
      const key = 'twelvedata|rohstoffe|XAUUSD|' + interval
      let reservation
      try { reservation = await reserveAutomaticCandles(key, undefined, 'archive') }
      catch (e) { errors.push((e as Error).message); throw e }
      if (reservation.token) {
        upstream++
        await state.market.insert(candleSeries).values({ symbol, market, interval, candleCount: 1, fetchedAt: new Date() }).onConflictDoUpdate({ target: [candleSeries.symbol, candleSeries.interval], set: { fetchedAt: new Date() } })
        await finishAutomaticCandles(key, reservation.token, null)
      }
      return []
    }
    state.fetch.mockImplementation(fetch)
    if (used) state.quotes.mockImplementationOnce(async () => { await fetch('XAUUSD', 'rohstoffe', '5min'); return { error: null, quotesFailed: 0 } })
    const report = await runCandleCollect({})
    expect(report.seriesFailed).toBe(used ? 1 : 0)
    expect(errors).toHaveLength(used ? 1 : 0)
    if (used) expect(errors[0]).toContain('gemeinsames Abrufkontingent')
    expect(upstream).toBe(1)
    const rows = await pg.query('SELECT attempts FROM automatic_candle_budget')
    expect((rows.rows[0] as { attempts: number }).attempts).toBe(1)
  })
})

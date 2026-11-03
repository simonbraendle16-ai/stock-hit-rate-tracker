import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import { stock, trade, candleSeries, candleCollectRun } from '@/lib/db/schema'

const state = vi.hoisted(() => ({ db: null as any, fetch: vi.fn(), quotes: vi.fn() }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('./candle-store', () => ({ getStoredCandles: state.fetch }))
vi.mock('./sync', () => ({ runSymbolSync: state.quotes }))
import { runCandleCollect, COLLECTED_INTERVALS, claimCollectHour } from './candle-collect'
import { activeTradeInstruments } from './active-trade-demand'

let pg: PGlite
beforeAll(async () => {
  pg = new PGlite(); state.db = drizzle(pg)
  const dialect = new PgDialect()
  for (const table of [stock, trade, candleSeries, candleCollectRun]) {
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
  await pg.exec('CREATE UNIQUE INDEX series_key ON candle_series(symbol,interval); CREATE TABLE background_job_gate(job text PRIMARY KEY,"ranAt" timestamptz NOT NULL)')
})
afterAll(async () => { await pg.close() })
beforeEach(async () => {
  await pg.exec('TRUNCATE stock,trade,candle_series,candle_collect_run,background_job_gate RESTART IDENTITY')
  await state.db.insert(stock).values({ id: 1, userId: 'synthetic', ticker: 'TEST', name: 'Isolated', market: 'aktien',
    providerSymbol: 'TEST', provider: 'yahoo', resolutionStatus: 'ok' })
  state.fetch.mockReset().mockResolvedValue([])
  state.quotes.mockReset().mockResolvedValue({ error: null, quotesFailed: 0 })
})
async function addTrade(id: number, status = 'aktiv', stockId = 1, userId = 'synthetic') {
  await state.db.insert(trade).values({ id, stockId, userId, ticker: 'TEST', name: 'Isolated', status })
}
async function nextHour() { await pg.exec(`UPDATE background_job_gate SET "ranAt"=now()-interval '61 minutes'`) }

describe('isolated active-trade maintenance on PostgreSQL', () => {
  it.each(['none', 'geplant', 'abgeschlossen'])('no automatic calls for %s demand, independent of waves', async status => {
    if (status !== 'none') await addTrade(1, status)
    expect(await runCandleCollect({ force: true })).toMatchObject({ ran: false, seriesFetched: 0, candlesPruned: 0 })
    expect(state.fetch).not.toHaveBeenCalled(); expect(state.quotes).not.toHaveBeenCalled()
    expect((await pg.query('SELECT * FROM background_job_gate')).rows).toEqual([])
  })
  it('one active trade updates each shared series once and scopes quote snapshots', async () => {
    await addTrade(1)
    const report = await runCandleCollect({})
    expect(report).toMatchObject({ ran: true, seriesFetched: COLLECTED_INTERVALS.length, seriesFailed: 0, candlesPruned: 0 })
    expect(state.fetch).toHaveBeenCalledTimes(COLLECTED_INTERVALS.length)
    expect(state.quotes).toHaveBeenCalledExactlyOnceWith({ trigger: 'cron', onlyStockIds: [1], maxResolves: 0 })
    for (const call of state.fetch.mock.calls) expect(call[3]).toMatchObject({ limit: 1, automatic: true, automaticRole: 'archive', requireFresh: true, provider: 'yahoo' })
  })
  it('multiple owners and trades sharing the symbol do not duplicate series', async () => {
    await addTrade(1); await addTrade(2)
    await state.db.insert(stock).values({ id: 2, userId: 'other', ticker: 'TEST', name: 'Isolated', market: 'aktien', providerSymbol: 'TEST', provider: 'yahoo', resolutionStatus: 'ok' })
    await addTrade(3, 'aktiv', 2, 'other')
    expect((await runCandleCollect({})).seriesFetched).toBe(COLLECTED_INTERVALS.length)
    await state.db.update(trade).set({ status: 'abgeschlossen' }).where(eq(trade.id, 1)); await nextHour()
    expect((await runCandleCollect({})).seriesFetched).toBe(COLLECTED_INTERVALS.length)
    await state.db.update(trade).set({ status: 'abgeschlossen' }); await nextHour()
    const calls = state.fetch.mock.calls.length
    expect((await runCandleCollect({})).ran).toBe(false); expect(state.fetch).toHaveBeenCalledTimes(calls)
  })
  it('rechecks closure during a running job and retains historical series', async () => {
    await addTrade(1)
    await state.db.insert(candleSeries).values({ symbol: 'HISTORY', interval: '1h', market: 'aktien', candleCount: 100, fetchedAt: new Date(0) })
    state.fetch.mockImplementationOnce(async () => { await state.db.update(trade).set({ status: 'abgeschlossen' }); return [] })
    expect((await runCandleCollect({})).seriesFetched).toBe(1)
    expect(state.quotes).toHaveBeenCalledTimes(1) // started while the trade was still active
    expect((await state.db.select().from(candleSeries))[0]).toMatchObject({ symbol: 'HISTORY', candleCount: 100 })
  })
  it('repeated, forced and parallel invocations share one persisted hourly claim', async () => {
    await addTrade(1)
    const reports = await Promise.all([runCandleCollect({}), runCandleCollect({ force: true }), runCandleCollect({})])
    expect(reports.filter(r => r.ran)).toHaveLength(1)
    expect(state.fetch).toHaveBeenCalledTimes(COLLECTED_INTERVALS.length)
    expect((await runCandleCollect({ force: true })).ran).toBe(false)
    await nextHour(); expect(await claimCollectHour()).toBe(true)
  })
  it('provider failure is counted, other series continue, and next hour recovers', async () => {
    await addTrade(1)
    state.fetch.mockRejectedValueOnce(new Error('isolated provider outage'))
    const report = await runCandleCollect({})
    expect(report.seriesFailed).toBe(1); expect(report.seriesFetched).toBe(COLLECTED_INTERVALS.length - 1)
    expect((await state.db.select().from(candleCollectRun))[0]).toMatchObject({ seriesFailed: 1 })
    await nextHour(); expect((await runCandleCollect({})).seriesFailed).toBe(0)
  })
  it('honors per-series 60-minute freshness and does not conflate a recent daily run', async () => {
    await addTrade(1)
    await state.db.insert(candleSeries).values({ symbol: 'TEST', interval: '1h', market: 'aktien', candleCount: 20, fetchedAt: new Date() })
    expect((await runCandleCollect({})).seriesFetched).toBe(COLLECTED_INTERVALS.length - 1)
    expect(state.fetch.mock.calls.some(c => c[2] === '1h')).toBe(false)
    await nextHour(); await state.db.update(candleSeries).set({ fetchedAt: new Date(Date.now() - 3_600_001) })
    expect((await runCandleCollect({})).seriesFetched).toBe(COLLECTED_INTERVALS.length)
  })
  it('does not accept a mismatched owner as active demand', async () => {
    await addTrade(1, 'aktiv', 1, 'foreign')
    expect(await activeTradeInstruments()).toEqual([])
    expect((await runCandleCollect({})).ran).toBe(false)
  })
  it('reports quote failure and time budget exhaustion without pretending completion', async () => {
    await addTrade(1); state.quotes.mockResolvedValueOnce({ error: null, quotesFailed: 1 })
    expect((await runCandleCollect({})).error).toContain('Snapshots')
    await nextHour()
    expect((await runCandleCollect({ timeBudgetMs: 0 })).error).toContain('Zeitbudget')
  })
})

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import { stock, trade, candleSeries, candleCollectRun, symbolSyncRun, quoteSnapshot } from '@/lib/db/schema'

const state = vi.hoisted(() => ({ db: null as any, market: null as any, fetch: vi.fn(), quotes: vi.fn(), provider: vi.fn() }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('./index', () => ({ resolveProvider: () => ({ getCandles: state.provider }), providerByName: () => ({ getCandles: state.provider }) }))
vi.mock('./yahoo', () => ({ getYahooQuotes: state.quotes, getYahooQuoteViaChart: vi.fn() }))
vi.mock('@/lib/link-trades', () => ({ linkLooseTrades: async () => ({ linked: 0 }) }))
import { getStoredCandles } from './candle-store'
import { AutomaticCandlePlan, AutomaticCandleDeferred } from '../automatic-candle-plan'
import { runCandleCollect, COLLECTED_INTERVALS, claimCollectHour } from './candle-collect'
import { activeTradeInstruments } from './active-trade-demand'
import { readFileSync } from 'node:fs'
vi.mock('./database',()=>({get marketDb(){return state.market}}))

import { reserveAutomaticCandles, finishAutomaticCandles } from '../automatic-candles'
let pg: PGlite; let marketPg:PGlite
beforeAll(async () => {
  pg = new PGlite(); state.db = drizzle(pg);marketPg=new PGlite();state.market=drizzle(marketPg)
  await marketPg.exec(readFileSync(new URL('../../drizzle-market/0001_market.sql',import.meta.url),'utf8'))
  const dialect = new PgDialect()
  for (const table of [stock, trade, symbolSyncRun, quoteSnapshot]) {
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
  await pg.exec('CREATE UNIQUE INDEX quote_key ON quote_snapshot(provider,symbol)')
  await pg.exec('CREATE TABLE background_job_gate(job text PRIMARY KEY,"ranAt" timestamptz NOT NULL)')
  await pg.exec("CREATE TABLE IF NOT EXISTS automatic_candle_budget (\r\n  hour timestamptz PRIMARY KEY,\r\n  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 150)\r\n);\r\nCREATE TABLE IF NOT EXISTS automatic_candle_fetch (\r\n  key text PRIMARY KEY,\r\n  hour timestamptz NOT NULL,\r\n  \"leaseUntil\" timestamptz NOT NULL,\r\n  token uuid NOT NULL,\r\n  since double precision,\r\n  attempts integer NOT NULL DEFAULT 1,\r\n  \"attemptedAt\" timestamptz NOT NULL DEFAULT now(),\r\n  \"completedAt\" timestamptz,\r\n  error text\r\n);\r\nCREATE TABLE IF NOT EXISTS automatic_provider_day (\r\n  provider text NOT NULL,\r\n  day date NOT NULL,\r\n  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 800),\r\n  PRIMARY KEY(provider,day)\r\n);")
})
afterAll(async () => { await pg.close();await marketPg.close() })
beforeEach(async () => {
  await pg.exec('TRUNCATE stock,trade,symbol_sync_run,quote_snapshot,background_job_gate,automatic_candle_budget,automatic_candle_fetch,automatic_provider_day RESTART IDENTITY')
  await state.db.insert(stock).values({ id: 1, userId: 'synthetic', ticker: 'TEST', name: 'Isolated', market: 'aktien',
    providerSymbol: 'TEST', provider: 'yahoo', resolutionStatus: 'ok' })
  await marketPg.exec('TRUNCATE candle_cache,candle_series,candle_collect_run RESTART IDENTITY')
  state.fetch.mockReset().mockResolvedValue([])
  state.quotes.mockReset().mockImplementation(async (symbols: string[]) => new Map(symbols.map(symbol => [symbol, {symbol, price: 10, time: 1000, name: 'Synthetic', currency: 'USD'}])))
  state.provider.mockReset().mockResolvedValue([{time:1000,open:99,high:102,low:98,close:101,volume:0}])
})
async function addTrade(id: number, status = 'aktiv', stockId = 1, userId = 'synthetic') {
  await state.db.insert(trade).values({ id, stockId, userId, ticker: 'TEST', name: 'Isolated', status })
}
async function nextHour() { await pg.exec(`UPDATE background_job_gate SET "ranAt"=now()-interval '61 minutes'`) }



async function gold(alias = 'XAUUSD') {
  await addTrade(1)
  await state.db.update(stock).set({ provider: 'twelvedata', providerSymbol: alias, market: 'rohstoffe' })
}
async function minuteAvailable() {
  await pg.exec(`UPDATE automatic_candle_fetch SET "leaseUntil"=now()-interval '65 seconds' WHERE "completedAt" IS NOT NULL`)
}
async function attempts() {
  return ((await pg.query('SELECT coalesce(sum(attempts),0)::int n FROM automatic_candle_budget')).rows[0] as {n:number}).n
}
describe('phase 4 real snapshot/store/reservation/collector integration in isolated A and B', () => {
  it.each(['XAUUSD','XAU/USD'])('repairs original conflict for %s and completes three phases with exactly three provider reservations', async alias => {
    await gold(alias)
    const main = await runCandleCollect({})
    expect(main).toMatchObject({error:null,seriesFailed:0,seriesDue:2,seriesDeferred:2,providerFetched:1,complete:false,outcome:'deferred'})
    expect(state.provider).toHaveBeenCalledExactlyOnceWith('XAU/USD','5min',undefined)
    expect(await attempts()).toBe(1)
    expect((await state.db.select().from(quoteSnapshot))[0]).toMatchObject({symbol:'XAUUSD',price:101,quotedAt:1000,failCount:0})
    expect((await state.market.select().from(candleSeries)).map((r:any)=>r.interval)).toEqual(['5min'])
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-1'})).toMatchObject({seriesFailed:0,seriesDeferred:1,seriesReused:1,providerFetched:1})
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-2'})).toMatchObject({seriesFailed:0,seriesDeferred:0,seriesReused:1,providerFetched:1,complete:true,outcome:'complete'})
    expect(state.provider.mock.calls.map(c=>c[1]).sort()).toEqual(['1day','1h','5min'])
    expect(await attempts()).toBe(3)
    expect((await pg.query('SELECT attempts FROM automatic_provider_day')).rows[0]).toEqual({attempts:3})
    expect(await runCandleCollect({})).toMatchObject({ran:false,outcome:'claimed',seriesDeferred:0})
    expect(await runCandleCollect({phase:'limited-1'})).toMatchObject({ran:false,seriesDeferred:0})
    expect(state.provider).toHaveBeenCalledTimes(3)
  })
  it('retains the control without a gold snapshot and scopes provider/interval identity', async () => {
    await gold('EURUSD')
    expect(await runCandleCollect({})).toMatchObject({seriesFailed:0,seriesFetched:1,providerFetched:1,error:null})
    expect(await attempts()).toBe(1)
    expect(state.provider).toHaveBeenCalledTimes(1)
    expect(state.provider.mock.calls[0][0]).toBe('EURUSD')
  })
  it('reuses a completed exact series without another upstream call or budget charge', async () => {
    await gold()
    await getStoredCandles('XAUUSD','rohstoffe','5min',{automatic:true,automaticRole:'archive',provider:'twelvedata',requireFresh:true,forceRefresh:true,limit:1})
    const report = await runCandleCollect({})
    expect(report).toMatchObject({seriesFailed:0,seriesReused:1,providerFetched:0,seriesDeferred:2,error:null})
    expect(await attempts()).toBe(1)
    expect(state.provider).toHaveBeenCalledTimes(1)
  })
  it('parallel and repeated main claims cannot consume quota twice or hide follow-up demand', async () => {
    await gold()
    const reports = await Promise.all([runCandleCollect({}),runCandleCollect({force:true}),runCandleCollect({})])
    expect(reports.filter(r=>r.ran)).toHaveLength(1)
    expect(reports.filter(r=>!r.ran).every(r=>r.seriesDeferred>0 && r.outcome==='claimed')).toBe(true)
    expect(await attempts()).toBe(1)
    expect(await runCandleCollect({})).toMatchObject({ran:false,seriesDeferred:2})
  })
  it('reports real minute contention as deferred, then recovers the missing snapshot without inventing completion', async () => {
    await gold()
    const key='twelvedata|forex|OTHER|1h'
    const r=await reserveAutomaticCandles(key,undefined,'archive')
    await finishAutomaticCandles(key,r.token!,null)
    expect(await runCandleCollect({})).toMatchObject({seriesFailed:0,quotesDeferred:1,seriesDeferred:3,complete:false,outcome:'deferred',error:null})
    expect(state.provider).not.toHaveBeenCalled()
    expect(await attempts()).toBe(1)
    expect(await state.market.select().from(candleSeries)).toHaveLength(0)
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-1'})).toMatchObject({quotesDeferred:0,providerFetched:1,seriesDeferred:2,error:null})
    expect(await state.db.select().from(quoteSnapshot)).toHaveLength(1)
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-2'})).toMatchObject({seriesDeferred:1,complete:false,outcome:'deferred'})
    expect(state.provider).toHaveBeenCalledTimes(2)
  })
  it.each(['provider','empty','storage','snapshot'])('keeps actual %s failures visible and does not mark missing data fresh', async failure => {
    await gold()
    if(failure==='provider')state.provider.mockRejectedValue(new Error('synthetic upstream outage'))
    if(failure==='empty')state.provider.mockResolvedValue([])
    if(failure==='storage') await marketPg.exec(`CREATE FUNCTION fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic storage outage'; END $$; CREATE TRIGGER synthetic_failure BEFORE INSERT ON candle_cache FOR EACH ROW EXECUTE FUNCTION fail_write();`)
    if(failure==='snapshot')await pg.exec(`CREATE FUNCTION fail_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic snapshot outage'; END $$; CREATE TRIGGER synthetic_failure BEFORE INSERT ON quote_snapshot FOR EACH ROW EXECUTE FUNCTION fail_snapshot();`)
    try {
      const report=await runCandleCollect({})
      expect(report).toMatchObject({complete:false,outcome:'failed'})
      expect(report.error).not.toBeNull()
      expect(state.provider).toHaveBeenCalledTimes(1)
      expect(await attempts()).toBe(1)
      if(failure!=='snapshot') {
        const rows=await state.market.select().from(candleSeries)
        expect(rows.every((r:any)=>r.fetchedAt===null)).toBe(true)
        expect((await state.db.select().from(quoteSnapshot))).toHaveLength(0)
      }
    } finally {
      if(failure==='storage') await marketPg.exec('DROP TRIGGER synthetic_failure ON candle_cache; DROP FUNCTION fail_write()')
      if(failure==='snapshot') await pg.exec('DROP TRIGGER synthetic_failure ON quote_snapshot; DROP FUNCTION fail_snapshot()')
    }
  })
  it('parallel distinct follow-up claims still share one minute budget', async () => {
    await gold(); await runCandleCollect({}); await minuteAvailable()
    const reports=await Promise.all([runCandleCollect({phase:'limited-1'}),runCandleCollect({phase:'limited-2'})])
    expect(reports.every(r=>r.seriesFailed===0 && r.error===null)).toBe(true)
    expect(state.provider).toHaveBeenCalledTimes(2)
    expect(await attempts()).toBe(2)
    expect((await state.market.select().from(candleSeries))).toHaveLength(2)
    expect(reports.every(r=>!r.complete)).toBe(true)
  })
  it('retains stale and failed series as outstanding and refreshes them in later eligible slots', async () => {
    await gold()
    await state.market.insert(candleSeries).values({symbol:'XAUUSD',market:'rohstoffe',interval:'1day',candleCount:1,fetchedAt:new Date(0)})
    expect(await runCandleCollect({})).toMatchObject({seriesDeferred:2,error:null})
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-1'})).toMatchObject({seriesDeferred:1,error:null})
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-2'})).toMatchObject({complete:true,error:null})
    expect((await state.market.select().from(candleSeries)).every((r:any)=>r.fetchedAt.getTime()>0)).toBe(true)
    expect(state.provider).toHaveBeenCalledTimes(3)
  })
  it('same-key repetition with one plan reuses the completed reservation and keeps unrelated intervals deferred', async () => {
    const automaticPlan=new AutomaticCandlePlan()
    const options={automaticPlan,automatic:true,automaticRole:'archive' as const,provider:'twelvedata' as const,requireFresh:true,forceRefresh:true,limit:1}
    const first=await getStoredCandles('XAUUSD','rohstoffe','5min',options)
    expect(await getStoredCandles('XAUUSD','rohstoffe','5min',options)).toEqual(first)
    await expect(getStoredCandles('XAUUSD','rohstoffe','1h',options)).rejects.toMatchObject({reason:'phase'})
    expect(automaticPlan).toMatchObject({fetched:1,reused:1})
    expect(state.provider).toHaveBeenCalledTimes(1)
    expect(await attempts()).toBe(1)
  })
  it('a rejected main claim exposes a missing snapshot even with all candle series fresh', async () => {
    await gold(); await runCandleCollect({}); await minuteAvailable()
    await runCandleCollect({phase:'limited-1'}); await minuteAvailable(); await runCandleCollect({phase:'limited-2'})
    await pg.exec('TRUNCATE quote_snapshot')
    expect(await runCandleCollect({})).toMatchObject({ran:false,seriesDeferred:0,quotesDeferred:1,outcome:'claimed',complete:false})
    // A separate next-hour/eligible continuation gate can rebuild A from B without another provider request.
    await pg.exec(`UPDATE background_job_gate SET "ranAt"=now()-interval '61 minutes' WHERE job='active-trade-market-data:limited-1'`)
    expect(await runCandleCollect({phase:'limited-1'})).toMatchObject({complete:true,seriesReused:1,providerFetched:0})
    expect(state.provider).toHaveBeenCalledTimes(3)
    expect(await state.db.select().from(quoteSnapshot)).toHaveLength(1)
  })
  it('does not equate an A reservation with missing B candles or fabricate freshness', async () => {
    const key='twelvedata|rohstoffe|XAUUSD|5min'
    const r=await reserveAutomaticCandles(key,undefined,'archive');await finishAutomaticCandles(key,r.token!,null)
    await expect(getStoredCandles('XAUUSD','rohstoffe','5min',{automatic:true,automaticRole:'archive',provider:'twelvedata',requireFresh:true,forceRefresh:true,limit:1})).rejects.toThrow('ohne gespeicherte')
    expect(state.provider).not.toHaveBeenCalled()
    expect(await attempts()).toBe(1)
    expect(await state.market.select().from(candleSeries)).toHaveLength(0)
  })
  it('mixed main demand retains ordinary quote and archive supply without repeating it in limited phases', async () => {
    await gold()
    await state.db.insert(stock).values({id:2,userId:'synthetic',ticker:'ORDINARY',name:'Synthetic',market:'aktien',providerSymbol:'ORDINARY',provider:'yahoo',resolutionStatus:'ok'})
    await addTrade(2,'aktiv',2)
    expect(await runCandleCollect({})).toMatchObject({seriesFailed:0,seriesDeferred:2})
    const ordinary=state.provider.mock.calls.filter(c=>c[0]==='ORDINARY').length
    expect(ordinary).toBe(COLLECTED_INTERVALS.length)
    await minuteAvailable();await runCandleCollect({phase:'limited-1'})
    await minuteAvailable();expect(await runCandleCollect({phase:'limited-2'})).toMatchObject({complete:true})
    expect(state.provider.mock.calls.filter(c=>c[0]==='ORDINARY')).toHaveLength(ordinary)
    expect(state.quotes.mock.calls.filter(c=>c[0].includes('ORDINARY'))).toHaveLength(1)
    expect(await attempts()).toBe(ordinary+3)
  })
  it('continues ordinary rows omitted by a capped main without refetching completed series', async () => {
    await gold()
    await state.db.insert(stock).values({id:2,userId:'synthetic',ticker:'ORDINARY',name:'Synthetic',market:'aktien',providerSymbol:'ORDINARY',provider:'yahoo',resolutionStatus:'ok'})
    await addTrade(2,'aktiv',2)
    expect(await runCandleCollect({maxFetches:1})).toMatchObject({seriesDeferred:COLLECTED_INTERVALS.length+1,complete:false})
    expect(await runCandleCollect({})).toMatchObject({ran:false,seriesDeferred:COLLECTED_INTERVALS.length+1})
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-1'})).toMatchObject({seriesDeferred:1,seriesFailed:0})
    await minuteAvailable()
    expect(await runCandleCollect({phase:'limited-2'})).toMatchObject({complete:true,seriesFailed:0})
    expect(state.provider.mock.calls.filter(c=>c[0]==='ORDINARY')).toHaveLength(COLLECTED_INTERVALS.length)
    expect(await attempts()).toBe(COLLECTED_INTERVALS.length+3)
  })
  it('preserves leases, retry delay and failed-attempt accounting with actual reservations', async () => {
    const key='twelvedata|rohstoffe|XAUUSD|5min'
    const first=await reserveAutomaticCandles(key,undefined,'archive')
    await expect(reserveAutomaticCandles(key,undefined,'archive')).rejects.toMatchObject({reason:'lease'})
    expect(await attempts()).toBe(1)
    await finishAutomaticCandles(key,first.token!,'synthetic interruption')
    await expect(reserveAutomaticCandles(key,undefined,'archive')).rejects.toMatchObject({reason:'retry'})
    await pg.exec(`UPDATE automatic_candle_fetch SET "attemptedAt"=now()-interval '6 minutes',"leaseUntil"=now()-interval '6 minutes'`)
    const second=await reserveAutomaticCandles(key,undefined,'archive')
    await expect(finishAutomaticCandles(key,first.token!,null)).rejects.toThrow('verloren')
    await finishAutomaticCandles(key,second.token!,null)
    expect(await attempts()).toBe(2)
    expect(await reserveAutomaticCandles(key,undefined,'archive')).toMatchObject({reused:true})
    expect(await attempts()).toBe(2)
  })
  it('does not raise hour/day limits and does not turn database errors into scheduling deferrals', async () => {
    await gold()
    await pg.exec(`INSERT INTO automatic_candle_budget VALUES(date_trunc('hour',now()),150)`)
    expect(await runCandleCollect({})).toMatchObject({outcome:'deferred',seriesFailed:0,quotesDeferred:1,seriesDeferred:3})
    expect(state.provider).not.toHaveBeenCalled()
    await pg.exec('TRUNCATE automatic_candle_budget,background_job_gate')
    await pg.exec(`INSERT INTO automatic_provider_day VALUES('twelvedata',current_date,800)`)
    expect(await runCandleCollect({})).toMatchObject({outcome:'deferred',seriesFailed:0,quotesDeferred:1,seriesDeferred:3})
    expect(await attempts()).toBe(0)
    expect(state.provider).not.toHaveBeenCalled()
    await pg.exec('TRUNCATE automatic_provider_day,background_job_gate; ALTER TABLE automatic_candle_budget RENAME TO unavailable_budget')
    try {
      const report=await runCandleCollect({})
      expect(report).toMatchObject({outcome:'failed',complete:false})
      expect(report.error).not.toBeNull()
    } finally { await pg.exec('ALTER TABLE unavailable_budget RENAME TO automatic_candle_budget') }
  })
})

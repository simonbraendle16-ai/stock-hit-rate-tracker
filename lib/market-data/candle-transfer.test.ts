import { beforeEach, describe, it, expect, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

const state = vi.hoisted(() => ({ db: null as any, provider: vi.fn() }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('./index', () => ({ resolveProvider: () => ({ getCandles: state.provider }), providerByName: () => ({ getCandles: state.provider }) }))
import { getStoredCandles, getStoredCloses } from './candle-store'

describe('bounded candle reads avoid unused series payload without changing data', () => {
  beforeEach(() => state.provider.mockReset())
  it('stored-only reads use one bounded SQL query; ordinary fresh reads fetch only fetchedAt metadata', async () => {
    const pg = new PGlite(), queries: string[] = []
    try {
      await pg.exec(`CREATE TABLE candle_cache(symbol text, interval text,time integer,open float8,high float8,low float8,close float8,volume float8, PRIMARY KEY(symbol,interval,time));
        CREATE TABLE candle_series(symbol text,interval text,"fetchedAt" timestamptz,"lastError" text,"executionSession" jsonb,market text,"firstTime" integer,"lastTime" integer,"candleCount" integer,"failCount" integer DEFAULT 0, PRIMARY KEY(symbol,interval));
        INSERT INTO candle_cache SELECT 'AAPL','1h',i,1,2,0,1,10 FROM generate_series(1,100) i;
        INSERT INTO candle_series(symbol,interval,"fetchedAt","lastError","executionSession") VALUES ('AAPL','1h',now(),repeat('synthetic unused error',10000),'{}');`)
      state.db = drizzle(pg, { logger: { logQuery(sql) { queries.push(sql) } } })
      const rows = await getStoredCandles('AAPL', 'aktien', '1h', { storedOnly: true, limit: 3 })
      expect(rows.map(c => c.time)).toEqual([98, 99, 100])
      expect(queries).toHaveLength(1)
      expect(queries[0]).toMatch(/limit/i)
      expect(queries[0]).not.toContain('candle_series')
      queries.length = 0
      expect(await getStoredCandles('AAPL', 'aktien', '1h', { limit: 3 })).toEqual(rows)
      const series = queries.filter(q => q.includes('candle_series'))
      expect(series).toHaveLength(1)
      expect(series[0]).toContain('fetchedAt')
      expect(series[0]).not.toMatch(/lastError|executionSession/)
      expect(state.provider).not.toHaveBeenCalled()
      queries.length = 0
      expect(await getStoredCloses('AAPL', 'aktien', '1h', 3)).toEqual(rows.map(row => row.close))
      expect(queries).toHaveLength(2)
      const closeRead = queries.find(q => q.includes('candle_cache'))!
      expect(closeRead).toMatch(/^select "close" from/)
      expect(closeRead).not.toMatch(/"open"|"high"|"low"|"volume"/)
      expect(closeRead).toMatch(/limit/i)
      // Stale series still refresh through the established provider/merge path.
      await pg.exec(`UPDATE candle_series SET "fetchedAt"='2000-01-01'`)
      state.provider.mockResolvedValueOnce([{ time: 101, open: 1, high: 3, low: 0, close: 2, volume: 10 }])
      expect(await getStoredCloses('AAPL', 'aktien', '1h', 3)).toEqual([1, 1, 2])
      expect(state.provider).toHaveBeenCalledOnce()
      // Existing stored values remain the fallback on provider failure.
      await pg.exec(`UPDATE candle_series SET "fetchedAt"='2000-01-01'`)
      state.provider.mockRejectedValueOnce(new Error('synthetic provider unavailable'))
      expect(await getStoredCloses('AAPL', 'aktien', '1h', 3)).toEqual([1, 1, 2])
    } finally { await pg.close() }
  })
})

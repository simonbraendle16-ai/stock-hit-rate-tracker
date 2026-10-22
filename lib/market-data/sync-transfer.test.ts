import { describe, it, expect, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { stock, symbolSyncRun, quoteSnapshot } from '@/lib/db/schema'

const state = vi.hoisted(() => ({ db: null as any, quotes: vi.fn() }))
vi.mock('@/lib/db', () => ({ get db() { return state.db } }))
vi.mock('./yahoo', () => ({ getYahooQuotes: state.quotes, getYahooQuoteViaChart: vi.fn() }))
vi.mock('@/lib/link-trades', () => ({ linkLooseTrades: async () => ({ linked: 0 }) }))
import { runSymbolSync } from './sync'

describe('recurring symbol synchronization projects only operational columns', () => {
  it('keeps source/quotes and scoped repair behavior while excluding oversized candidate payload', async () => {
    const pg = new PGlite(), queries: { sql: string; params: unknown[] }[] = []
    try {
      for (const table of [stock, symbolSyncRun, quoteSnapshot]) {
        const config = getTableConfig(table)
        await pg.exec(`CREATE TABLE "${config.name}" (${config.columns.map(c => `"${c.name}" ${c.getSQLType()}`).join(',')})`)
      }
      await pg.exec('CREATE UNIQUE INDEX quote_key ON quote_snapshot(provider,symbol)')
      state.db = drizzle(pg, { logger: { logQuery(sql, params) { queries.push({ sql, params }) } } })
      await state.db.insert(stock).values([
        { id: 1, userId: 'synthetic', ticker: 'AAPL', name: 'Synthetic one', market: 'aktien', providerSymbol: 'AAPL', resolutionStatus: 'ok', resolutionPinned: true, resolutionCandidates: 'x'.repeat(65536) },
        { id: 2, userId: 'synthetic', ticker: 'MSFT', name: 'Synthetic two', market: 'aktien', providerSymbol: 'MSFT', resolutionStatus: 'ok', resolutionPinned: true },
      ])
      state.quotes.mockImplementation(async (symbols: string[]) => new Map(symbols.map(symbol => [symbol,
        { symbol, price: 10, currency: 'USD', previousClose: 9, changePct: 1, exchange: 'synthetic', name: symbol, time: Math.floor(Date.now() / 1000) }])))
      for (const onlyStockIds of [undefined, [1]]) {
        queries.length = 0
        const result = await runSymbolSync({ trigger: 'manual', onlyStockIds, maxResolves: 0 })
        expect(result.error).toBeNull()
        expect(result.symbolsTotal).toBe(onlyStockIds ? 1 : 2)
        expect(result.quotesUpdated).toBe(result.symbolsTotal)
        const reads = queries.filter(q => /^select /i.test(q.sql) && q.sql.includes('from "stock"'))
        expect(reads).toHaveLength(2)
        for (const q of reads) {
          expect(q.sql).not.toMatch(/resolutionCandidates|contractSize|chartUrl/)
          expect(q.sql).toContain('resolutionPinned')
          const rows = (await pg.query(q.sql, q.params)).rows
          expect(Buffer.byteLength(JSON.stringify(rows))).toBeLessThan(2000)
          if (onlyStockIds) expect(rows.map((r: any) => r.id)).toEqual([1])
        }
      }
    } finally { await pg.close() }
  })
})

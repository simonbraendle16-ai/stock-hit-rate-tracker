import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { YahooQuote } from './market-data/yahoo'

const state = vi.hoisted(() => ({ rows: [] as unknown[][], inserted: [] as Record<string, unknown>[], quotes: vi.fn() }))
vi.mock('@/lib/market-data/yahoo', () => ({ getYahooQuotes: state.quotes, searchYahoo: vi.fn(async () => []) }))
vi.mock('@/lib/db', () => {
  const db = {
    select: () => {
      const query = { from: () => query, where: () => query, limit: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(state.rows.shift() ?? []).then(resolve) }
      return query
    },
    insert: () => ({ values: (values: Record<string, unknown>) => {
      state.inserted.push(values)
      return { returning: async () => [{ id: 50 }] }
    } }),
    transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  }
  return { db }
})
vi.mock('@/lib/portfolio-context', () => ({
  loadOwnedPortfolio: async () => ({ id: 2, kind: 'demo', currency: 'GBP' }), kindOf: () => 'demo',
}))
import { findInstrumentFor } from './link-trades'
import { createTradeForUser } from './create-trade-service'

const london = { id: 7, ticker: 'EXM.L', providerSymbol: 'EXM.L' }
const xetra = { id: 8, ticker: 'EXM.DE', providerSymbol: 'EXM.DE' }
const quote = (symbol: string): YahooQuote => ({ symbol, name: 'Example Company', price: 100,
  previousClose: 99, changePct: 1, currency: 'GBP', financialCurrency: 'GBP', exchange: 'LSE',
  time: 1700000000, marketState: null, quoteType: 'EQUITY', volume: 1000 })

beforeEach(() => {
  state.rows = []; state.inserted = []
  state.quotes.mockReset().mockImplementation(async () => new Map([['EXM.L', quote('EXM.L')]]))
})

describe('Gemeinsamer Trade-/Instrumentpfad mit expliziter Notierung', () => {
  it.each([0, -1, NaN, Infinity])('lehnt ungültige Planpreise %s vor Instrument-Schreibzugriffen ab', async (price) => {
    for (const field of ['entryPrice', 'stopLoss'] as const) {
      await expect(createTradeForUser('test-user', { ticker: 'LSE:EXM', direction: 'long',
        entryPrice: 100, stopLoss: 95, takeProfit: 110, [field]: price })).rejects.toThrow('Einstieg')
    }
    expect(state.inserted).toEqual([])
    expect(state.quotes).not.toHaveBeenCalled()
  })
  it('lehnt doppelte Vorabantworten vor Instrument-Schreibzugriffen ab', async () => {
    await expect(createTradeForUser('test-user', { ticker: 'LSE:EXM', direction: 'long',
      entryPrice: 100, stopLoss: 95, takeProfit: 110,
      preTradeAnswers: Array.from({ length: 9 }, () => ({ key: 'risk', question: 'Ist dir dein Risiko bewusst?', answer: 'ja', note: '' }))
    })).rejects.toThrow('doppelt')
    expect(state.inserted).toEqual([])
    expect(state.quotes).not.toHaveBeenCalled()
  })
  it.each(['LSE:EXM', 'EXM.L'])('verknüpft %s nicht vorzeitig mit dem fremden Handelsplatz', async (ticker) => {
    const result = await findInstrumentFor(ticker, 'aktien', [xetra])
    expect(result.stockId).toBeNull()
    expect(result.viaSymbol).toBe('EXM.L')
  })
  it('verknüpft den expliziten London-Trade trotz vorhandener Xetra-Notierung korrekt', async () => {
    const result = await findInstrumentFor('LSE:EXM', 'aktien', [xetra, london])
    expect(result).toMatchObject({ stockId: 7, reason: 'anbieter-symbol', viaSymbol: 'EXM.L' })
  })
  it('speichert bei der Anlage die korrekt aufgelöste stockId ohne neues Instrument', async () => {
    state.rows = [[], [xetra, london]]
    await createTradeForUser('test-user', { portfolioId: 2, ticker: 'LSE:EXM', market: 'aktien',
      tradeKind: 'langfristig', direction: 'long', entryPrice: 100, stopLoss: 95, takeProfit: 110, quoteCurrency: 'GBP' })
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]).toMatchObject({ stockId: 7, ticker: 'LSE:EXM', status: 'geplant', preTradeAnswered: false })
  })
  it('erhält die bisherige eindeutige Zuordnung unqualifizierter Ticker', async () => {
    expect(await findInstrumentFor('EXM', 'aktien', [xetra])).toMatchObject({ stockId: 8, reason: 'grundticker' })
    expect(state.quotes).not.toHaveBeenCalled()
  })
})

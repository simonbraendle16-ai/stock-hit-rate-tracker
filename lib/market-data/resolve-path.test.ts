// Synthetische Regressionen für den vollständigen Resolver, keine Nutzerfälle.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCandidates, resolveSymbol } from './resolve'
import { getYahooQuotes, searchYahoo, type YahooQuote } from './yahoo'

vi.mock('./yahoo', () => ({ getYahooQuotes: vi.fn(), searchYahoo: vi.fn() }))

function quote(symbol: string, currency = 'EUR', volume = 1000): YahooQuote {
  return { symbol, name: 'Example Company', price: 100, previousClose: 99,
    changePct: 1, currency, financialCurrency: 'EUR', exchange: symbol,
    time: 1700000000, marketState: null, quoteType: 'EQUITY', volume }
}

beforeEach(() => {
  vi.mocked(searchYahoo).mockResolvedValue([])
  vi.mocked(getYahooQuotes).mockResolvedValue(new Map())
})

describe('explizite Paare und Handelsplätze', () => {
  it.each(['BTC-EUR', 'BTC/EUR', 'BTCEUR'])('erhält die EUR-Notierung von %s', async (ticker) => {
    const candidates = await buildCandidates({ ticker, name: 'Bitcoin', market: 'krypto' })
    expect(candidates.some(c => c.symbol === 'BTC-EUR')).toBe(true)
    expect(candidates.some(c => c.symbol === 'BTC-USD')).toBe(false)
    expect(candidates.some(c => c.symbol.includes('--'))).toBe(false)
  })

  it.each(['BTC-USDT', 'BTC/USDT', 'BTCUSDT'])('ersetzt bei %s USDT nicht durch USD', async (ticker) => {
    const candidates = await buildCandidates({ ticker, name: 'Bitcoin', market: 'krypto' })
    expect(candidates.some(c => c.symbol === 'BTC-USDT')).toBe(true)
    expect(candidates.some(c => c.symbol === 'BTC-USD')).toBe(false)
  })

  it.each(['LSE:EXM', 'EXM.L'])('bleibt für %s am gewählten Handelsplatz', async (ticker) => {
    vi.mocked(searchYahoo).mockResolvedValue([
      { symbol: 'EXM.DE', name: 'Example Company', quoteType: 'EQUITY', exchange: 'GER', exchangeName: 'XETRA' },
    ])
    vi.mocked(getYahooQuotes).mockResolvedValue(new Map([
      ['EXM.L', quote('EXM.L', 'GBP', 1)], ['EXM.DE', quote('EXM.DE', 'EUR', 100000)],
    ]))
    const result = await resolveSymbol({ ticker, name: 'Example Company', market: 'aktien' })
    expect(result.status).toBe('ok')
    expect(result.symbol).toBe('EXM.L')
    expect(result.currency).toBe('GBP')
  })

  it('wechselt bei fehlender expliziter Notierung nicht heimlich die Börse', async () => {
    vi.mocked(getYahooQuotes).mockResolvedValue(new Map([['EXM.DE', quote('EXM.DE')]]))
    const result = await resolveSymbol({ ticker: 'LSE:EXM', name: 'Example Company', market: 'aktien' })
    expect(result.status).toBe('unresolved')
    expect(result.symbol).toBeNull()
  })

  it('fasst gleiche Tickerwurzel und Bilanzwährung ohne passenden Namen nicht zusammen', async () => {
    vi.mocked(getYahooQuotes).mockResolvedValue(new Map([
      ['EXM', { ...quote('EXM'), name: 'Alpha Mining' }],
      ['EXM.DE', { ...quote('EXM.DE'), name: 'Beta Software', volume: 100000 }],
    ]))
    const result = await resolveSymbol({ ticker: 'EXM', name: '', market: 'aktien' })
    // Ohne Zusammenfassung konkurrieren die Identitäten: 14 Punkte Vorsprung
    // des exakten Tickers reichen hier, der liquidere fremde Wert gewinnt nicht.
    expect(result.symbol).toBe('EXM')
  })

  it('ordnet ein explizites EUR-Paar auch bei einem liquideren USD-Treffer korrekt zu', async () => {
    vi.mocked(searchYahoo).mockResolvedValue([
      { symbol: 'BTC-USD', name: 'Bitcoin USD', quoteType: 'CRYPTOCURRENCY', exchange: '', exchangeName: '' },
    ])
    vi.mocked(getYahooQuotes).mockResolvedValue(new Map([
      ['BTC-EUR', { ...quote('BTC-EUR'), name: 'Bitcoin EUR', quoteType: 'CRYPTOCURRENCY' }],
      ['BTC-USD', { ...quote('BTC-USD', 'USD', 100000), name: 'Bitcoin USD', quoteType: 'CRYPTOCURRENCY' }],
    ]))
    const result = await resolveSymbol({ ticker: 'BTC/EUR', name: 'Bitcoin', market: 'krypto' })
    expect(result.symbol).toBe('BTC-EUR')
    expect(result.currency).toBe('EUR')
  })
})

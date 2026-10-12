import { afterEach, describe, expect, it, vi } from 'vitest'
import { getYahooQuotes, getYahooQuoteViaChart } from './yahoo'

afterEach(() => vi.unstubAllGlobals())

function respond(meta: Record<string, unknown>, candles = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
    const address = String(url)
    if (address.includes('fc.yahoo.com')) return new Response('', { headers: { 'set-cookie': 'test=dummy' } })
    if (address.includes('getcrumb')) return new Response('dummy')
    if (address.includes('/v7/')) return Response.json({ quoteResponse: { result: [meta] } })
    return Response.json({ chart: { result: [{ meta, ...(candles ? {
      timestamp: [1700000000], indicators: { quote: [{ open: [10], high: [12], low: [9], close: [11] }] },
    } : {}) }] } })
  }))
}

describe('Yahoo-Kurse ohne erfundene Aktualität', () => {
  it('verwirft einen Batch-Kurs ohne tatsächliche Kurszeit', async () => {
    respond({ symbol: 'EXM', regularMarketPrice: 10 })
    expect((await getYahooQuotes(['EXM'])).size).toBe(0)
  })

  it.each([NaN, Infinity, 0, -1])('verwirft ungültigen Batch-Preis %s', async (price) => {
    respond({ symbol: 'EXM', regularMarketPrice: price, regularMarketTime: 1700000000 })
    expect((await getYahooQuotes(['EXM'])).size).toBe(0)
  })

  it('behält Kurszeit und Notierungswährung unverändert', async () => {
    respond({ symbol: 'EXM', regularMarketPrice: 10, regularMarketTime: 1700000000, currency: 'GBp' })
    expect((await getYahooQuotes(['EXM'])).get('EXM')).toMatchObject({ time: 1700000000, currency: 'GBp', price: 10 })
  })

  it('verwirft einen Chart-Kurs ohne belegte Kurszeit', async () => {
    respond({ symbol: 'EXM', regularMarketPrice: 10 })
    await expect(getYahooQuoteViaChart('EXM')).rejects.toMatchObject({ code: 'upstream' })
  })

  it('verwendet ohne Metadatenpreis den Schluss UND die Zeit der letzten Kerze', async () => {
    respond({ symbol: 'EXM', regularMarketTime: 1800000000, currency: 'EUR' }, true)
    expect(await getYahooQuoteViaChart('EXM')).toMatchObject({ price: 11, time: 1700000000 })
  })
})

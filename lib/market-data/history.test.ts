import { afterEach, describe, expect, it, vi } from 'vitest'
import { twelveDataProvider } from './twelvedata'
import { binanceProvider, toBinanceSymbol } from './binance'
import { resolveProvider } from './index'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
describe('Historischer Anfang statt gekürzter aktueller Daten', () => {
  it('verwendet für ältere Aktienhistorie die Archivquelle statt eines gekürzten Yahoo-Fensters', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T12:00Z'))
    vi.stubEnv('TWELVEDATA_API_KEY', 'test')
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ values: [
      { datetime: '2026-07-28 14:00:00', open: '400', high: '401', low: '399', close: '400' },
    ] }) }))
    vi.stubGlobal('fetch', fetcher)
    await resolveProvider('aktien').getCandles('TSLA', '5min', Date.parse('2026-07-28T14:00Z') / 1000)
    expect((fetcher.mock.calls[0] as unknown as [URL])[0].hostname).toBe('api.twelvedata.com')
  })

  it('fragt Twelve Data mit UTC-Zeitfenster und maximaler Historientiefe an', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'test')
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
      values: [{ datetime: '2026-07-28 14:00:00', open: '400', high: '401', low: '399', close: '400' }],
    }) }))
    vi.stubGlobal('fetch', fetcher)
    const result = await twelveDataProvider.getCandles('TSLA', '5min', Date.parse('2026-07-28T14:00Z') / 1000)
    const params = (fetcher.mock.calls[0] as unknown as [URL])[0].searchParams
    expect(params.get('start_date')).toBe('2026-07-28 14:00:00')
    expect(params.get('timezone')).toBe('UTC')
    expect(params.get('order')).toBe('asc')
    expect(params.get('outputsize')).toBe('5000')
    expect(params.get('end_date')).toBeTruthy()
    expect(result[0].time).toBe(Date.parse('2026-07-28T14:00Z') / 1000)
  })
  it('fragt Binance ab dem verlangten historischen Anfang an', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => [[1785247200000,'400','401','399','400','1']] }))
    vi.stubGlobal('fetch', fetcher)
    await binanceProvider.getCandles('BTC-USD', '5min', 1785247200)
    const params = (fetcher.mock.calls[0] as unknown as [URL])[0].searchParams
    expect(params.get('startTime')).toBe('1785247200000')
    expect(params.get('symbol')).toBe('BTCUSDT')
    expect(toBinanceSymbol('BTCUSDT')).toBe('BTCUSDT')
    expect(toBinanceSymbol('ETHEUR')).toBe('ETHEUR')
  })
})

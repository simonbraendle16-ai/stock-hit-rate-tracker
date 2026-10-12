import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSymbol } from './resolve'
import { resolveProvider } from './index'
import { getSpotGoldQuote } from './spot-gold'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })
const response = (datetime = '2026-10-12 18:00:00') => ({ values: [
  { datetime, open: '4170', high: '4172', low: '4169', close: '4171' },
] })
describe('Exakte Gold-Spotquelle', () => {
  it('bestätigt Spot mit eigener Identität und tatsächlicher Kurszeit', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T18:10Z'))
    vi.stubEnv('TWELVEDATA_API_KEY', 'synthetic')
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json(response()))
    vi.stubGlobal('fetch', fetcher)
    const result = await resolveSymbol({ ticker: 'XAUUSD', name: 'Gold', market: 'rohstoffe' })
    expect(result).toMatchObject({ status: 'ok', symbol: 'XAUUSD', provider: 'twelvedata', approximate: false, currency: 'USD' })
    const url = fetcher.mock.calls[0]?.[0] as unknown as URL
    expect(url.hostname).toBe('api.twelvedata.com')
    expect(url.searchParams.get('symbol')).toBe('XAU/USD')
    expect(url.searchParams.get('timezone')).toBe('UTC')
    expect(await getSpotGoldQuote()).toMatchObject({ time: Date.parse('2026-10-12T18:00Z') / 1000 })
  })
  it('fällt bei Ausfall niemals auf einen Future zurück', async () => {
    vi.stubEnv('TWELVEDATA_API_KEY', 'synthetic')
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ status: 'error', code: 429 }))
    vi.stubGlobal('fetch', fetcher)
    expect(await resolveSymbol({ ticker: 'XAU/USD', name: 'Gold', market: 'rohstoffe' })).toMatchObject({ status: 'unresolved', symbol: null })
    await expect(resolveProvider('rohstoffe').getCandles('XAUUSD', '5min')).rejects.toMatchObject({ code: 'rate_limit' })
    expect(fetcher.mock.calls.every(call => String(call[0]).includes('api.twelvedata.com'))).toBe(true)
  })
  it('verwirft einen Spotkurs aus der Zukunft', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T18:10Z'))
    vi.stubEnv('TWELVEDATA_API_KEY', 'synthetic')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(response('2026-10-13 05:00:00'))))
    await expect(getSpotGoldQuote()).rejects.toThrow('Kurszeit')
  })
})

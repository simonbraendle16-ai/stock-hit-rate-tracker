import {
  Candle,
  DEFAULT_OUTPUT_SIZE,
  Interval,
  MarketDataError,
  MarketDataProvider,
} from './types'

const BINANCE_INTERVAL: Record<Interval, string> = {
  '15min': '15m',
  '30min': '30m',
  '1h': '1h',
  '4h': '4h',
  '1day': '1d',
  '1week': '1w',
  '1month': '1M',
}

/** `BTC` → `BTCUSDT`; bereits vollständige Paare (`BTCUSDT`, `ETHEUR`) bleiben unverändert. */
export function toBinanceSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const quoteSuffixes = ['USDT', 'USDC', 'BUSD', 'EUR', 'BTC', 'ETH']
  if (quoteSuffixes.some((q) => s.length > q.length && s.endsWith(q))) return s
  return `${s}USDT`
}

export const binanceProvider: MarketDataProvider = {
  async getCandles(symbol: string, interval: Interval): Promise<Candle[]> {
    const pair = toBinanceSymbol(symbol)
    const url = new URL('https://api.binance.com/api/v3/klines')
    url.searchParams.set('symbol', pair)
    url.searchParams.set('interval', BINANCE_INTERVAL[interval])
    url.searchParams.set('limit', String(Math.min(DEFAULT_OUTPUT_SIZE[interval], 1000)))

    const res = await fetch(url, { cache: 'no-store' })
    if (res.status === 400) {
      throw new MarketDataError(
        `Unbekanntes Krypto-Symbol „${symbol}“ (Binance-Paar ${pair}).`,
        'unknown_symbol',
      )
    }
    if (res.status === 418 || res.status === 429) {
      throw new MarketDataError('Binance-Rate-Limit erreicht — bitte kurz warten.', 'rate_limit')
    }
    if (!res.ok) {
      throw new MarketDataError(`Binance antwortet mit Status ${res.status}.`, 'upstream')
    }

    const rows = (await res.json()) as unknown[]
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new MarketDataError(`Keine Kursdaten für „${symbol}“ gefunden.`, 'unknown_symbol')
    }

    return rows.map((r) => {
      const [openTime, open, high, low, close, volume] = r as [
        number,
        string,
        string,
        string,
        string,
        string,
      ]
      return {
        time: Math.floor(openTime / 1000),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      }
    })
  },
}

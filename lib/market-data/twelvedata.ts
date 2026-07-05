import {
  Candle,
  DEFAULT_OUTPUT_SIZE,
  Interval,
  MarketDataError,
  MarketDataProvider,
} from './types'

const TD_INTERVAL: Record<Interval, string> = {
  '1h': '1h',
  '4h': '4h',
  '1day': '1day',
  '1week': '1week',
  '1month': '1month',
}

interface TdValue {
  datetime: string
  open: string
  high: string
  low: string
  close: string
  volume?: string
}

export const twelveDataProvider: MarketDataProvider = {
  async getCandles(symbol: string, interval: Interval): Promise<Candle[]> {
    const apiKey = process.env.TWELVEDATA_API_KEY
    if (!apiKey) {
      throw new MarketDataError('TWELVEDATA_API_KEY ist nicht gesetzt.', 'upstream')
    }

    const url = new URL('https://api.twelvedata.com/time_series')
    url.searchParams.set('symbol', symbol.toUpperCase())
    url.searchParams.set('interval', TD_INTERVAL[interval])
    url.searchParams.set('outputsize', String(DEFAULT_OUTPUT_SIZE[interval]))
    url.searchParams.set('timezone', 'UTC')
    url.searchParams.set('apikey', apiKey)

    const res = await fetch(url, { cache: 'no-store' })
    if (res.status === 404) {
      throw new MarketDataError(
        `Unbekannter Ticker „${symbol}“ bei Twelve Data.`,
        'unknown_symbol',
      )
    }
    if (res.status === 429) {
      throw new MarketDataError(
        'Twelve-Data-Gratis-Limit erreicht (~8 Requests/Minute) — bitte kurz warten.',
        'rate_limit',
      )
    }
    if (!res.ok) {
      throw new MarketDataError(`Twelve Data antwortet mit Status ${res.status}.`, 'upstream')
    }

    const data = (await res.json()) as {
      status?: string
      code?: number
      message?: string
      values?: TdValue[]
    }

    if (data.status === 'error' || !data.values) {
      if (data.code === 429) {
        throw new MarketDataError(
          'Twelve-Data-Gratis-Limit erreicht (~8 Requests/Minute) — bitte kurz warten.',
          'rate_limit',
        )
      }
      if (data.code === 400 || data.code === 404) {
        throw new MarketDataError(
          `Unbekannter Ticker „${symbol}“ bei Twelve Data.`,
          'unknown_symbol',
        )
      }
      throw new MarketDataError(
        data.message ?? `Twelve Data lieferte keine Daten für „${symbol}“.`,
        'upstream',
      )
    }

    if (data.values.length === 0) {
      throw new MarketDataError(`Keine Kursdaten für „${symbol}“ gefunden.`, 'unknown_symbol')
    }

    // Twelve Data liefert neueste zuerst; Chart braucht aufsteigend.
    return data.values
      .map((v) => ({
        time: Math.floor(Date.parse(`${v.datetime.replace(' ', 'T')}Z`) / 1000),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: Number(v.volume ?? 0),
      }))
      .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time)
  },
}

import { unstable_cache } from 'next/cache'
import { Interval, Market, resolveProvider } from './index'

// Intraday 15 min, Daily und größer 12 h — schont das Twelve-Data-Gratis-Limit.
const INTRADAY: Interval[] = ['15min', '30min', '1h', '4h']

export function revalidateFor(interval: Interval): number {
  return INTRADAY.includes(interval) ? 60 * 15 : 60 * 60 * 12
}

/** Gemeinsamer, gecachter Kerzen-Getter für `/api/candles` und `/api/sparklines`. */
export function getCachedCandles(symbol: string, market: Market, interval: Interval) {
  return unstable_cache(
    async () => resolveProvider(market).getCandles(symbol, interval),
    ['candles', symbol, market, interval],
    { revalidate: revalidateFor(interval) },
  )()
}

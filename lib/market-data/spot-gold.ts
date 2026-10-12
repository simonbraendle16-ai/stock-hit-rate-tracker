import { twelveDataProvider } from './twelvedata'
import type { YahooQuote } from './yahoo'

/** Separate cache identity: GC=F history must never become XAU/USD history. */
export const SPOT_GOLD_SYMBOL = 'XAUUSD'
export function isSpotGoldTicker(ticker: string): boolean {
  return /^(?:XAUUSD|XAU\/USD)$/.test(ticker.trim().toUpperCase())
}

export async function getSpotGoldQuote(): Promise<YahooQuote> {
  const candles = await twelveDataProvider.getCandles('XAU/USD', '5min')
  const last = candles.at(-1)
  if (!last || last.time > Date.now() / 1000 || !(last.close > 0)) {
    throw new Error('Keine gültige XAU/USD-Spotkerze mit bestätigter Kurszeit.')
  }
  return { symbol: SPOT_GOLD_SYMBOL, name: 'Gold Spot / US Dollar', exchange: 'Commodity Aggregate',
    currency: 'USD', financialCurrency: null, price: last.close, time: last.time,
    quoteType: 'COMMODITY', previousClose: null, changePct: null, marketState: null, volume: null }
}

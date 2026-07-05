import { binanceProvider } from './binance'
import { twelveDataProvider } from './twelvedata'
import { Market, MarketDataError, MarketDataProvider } from './types'

export * from './types'

/**
 * `krypto` → Binance (gratis, ohne Key), alles andere → Twelve Data.
 * Forex/Optionen haben im Gratis-Tier keine verlässlichen Daten → 'unsupported',
 * die UI fällt dort auf den bestehenden TradingView-Link zurück.
 */
export function resolveProvider(market: Market): MarketDataProvider {
  if (market === 'krypto') return binanceProvider
  if (market === 'forex' || market === 'optionen') {
    return {
      async getCandles() {
        throw new MarketDataError(
          'Für Forex/Optionen gibt es im Gratis-Tier keine Kursdaten — bitte den TradingView-Link nutzen.',
          'unsupported',
        )
      },
    }
  }
  return twelveDataProvider
}

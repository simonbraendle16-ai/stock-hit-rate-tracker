import { binanceProvider } from './binance'
import { twelveDataProvider } from './twelvedata'
import { Market, MarketDataError, MarketDataProvider } from './types'

export * from './types'

/**
 * 6-Buchstaben-Paar (EURUSD, XAUUSD) → Twelve-Data-Format `EUR/USD`.
 * Symbole mit `/` oder anderer Länge bleiben unverändert.
 */
function normalizePair(symbol: string): string {
  const s = symbol.toUpperCase().trim()
  if (s.includes('/')) return s
  if (/^[A-Z]{6}$/.test(s)) return `${s.slice(0, 3)}/${s.slice(3)}`
  return s
}

/** Forex/Rohstoff-Paare laufen über Twelve Data (Gratis-Tier), nur normalisiert. */
const pairProvider: MarketDataProvider = {
  getCandles: (symbol, interval) =>
    twelveDataProvider.getCandles(normalizePair(symbol), interval),
}

/**
 * `krypto` → Binance (gratis, ohne Key) · `forex`/`rohstoffe` → Twelve Data mit
 * Paar-Normalisierung · `optionen` → keine Gratis-Daten ('unsupported', UI fällt
 * auf den TradingView-Link zurück) · Rest → Twelve Data direkt.
 */
export function resolveProvider(market: Market): MarketDataProvider {
  if (market === 'krypto') return binanceProvider
  if (market === 'forex' || market === 'rohstoffe') return pairProvider
  if (market === 'optionen') {
    return {
      async getCandles() {
        throw new MarketDataError(
          'Für Optionen gibt es im Gratis-Tier keine Kursdaten — bitte den TradingView-Link nutzen.',
          'unsupported',
        )
      },
    }
  }
  return twelveDataProvider
}

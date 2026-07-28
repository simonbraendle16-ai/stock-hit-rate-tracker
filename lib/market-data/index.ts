import { binanceProvider } from './binance'
import { twelveDataProvider } from './twelvedata'
import { yahooProvider } from './yahoo'
import { Market, MarketDataError, MarketDataProvider } from './types'

export * from './types'

export type ProviderName = 'yahoo' | 'twelvedata' | 'binance'

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

/** Ein Anbieter über seinen Namen — für Symbole mit hinterlegter Auflösung. */
export function providerByName(name: ProviderName): MarketDataProvider {
  if (name === 'binance') return binanceProvider
  if (name === 'twelvedata') return twelveDataProvider
  return yahooProvider
}

/**
 * Rückfallreihenfolge je Markt.
 *
 * Yahoo steht überall vorn — es ist die einzige Gratis-Quelle, die Aktien,
 * Indizes, Terminkontrakte, Devisen UND Krypto zugleich abdeckt und dabei
 * gebündelt abfragbar ist (alle Symbole in einem Request statt in ~90). Twelve
 * Data war bis Etappe 9 die Primärquelle und ist jetzt Rückfallebene: sein
 * Gratis-Tier erlaubt 8 Anfragen pro Minute und kennt weder Terminkontrakte
 * noch Indizes noch die Heimatbörsen XETRA/Euronext/HKEX.
 *
 * Für Optionen gibt es weiterhin nichts Kostenloses — dort bleibt der
 * TradingView-Link die ehrliche Antwort.
 */
export function providerChain(
  market: Market,
): Array<{ name: ProviderName; provider: MarketDataProvider }> {
  if (market === 'optionen') return []
  const chain: Array<{ name: ProviderName; provider: MarketDataProvider }> = [
    { name: 'yahoo', provider: yahooProvider },
  ]
  if (market === 'krypto') {
    chain.push({ name: 'binance', provider: binanceProvider })
  } else if (market === 'forex' || market === 'rohstoffe') {
    chain.push({ name: 'twelvedata', provider: pairProvider })
  } else {
    chain.push({ name: 'twelvedata', provider: twelveDataProvider })
  }
  return chain
}

/**
 * Anbieter mit Rückfallebene: schlägt der erste fehl, übernimmt der nächste.
 *
 * Weitergereicht wird bewusst NUR bei Anbieterproblemen (Ausfall, Rate-Limit).
 * Ein unbekanntes Symbol ist kein Anbieterproblem, sondern ein Auflösungs-
 * problem; es beim nächsten Anbieter erneut zu versuchen würde den Fehler nur
 * verschleiern, statt ihn dem Nutzer als reparierbaren Zustand zu zeigen.
 */
export function resolveProvider(market: Market): MarketDataProvider {
  const chain = providerChain(market)
  if (chain.length === 0) {
    return {
      async getCandles() {
        throw new MarketDataError(
          'Für Optionen gibt es im Gratis-Tier keine Kursdaten — bitte den TradingView-Link nutzen.',
          'unsupported',
        )
      },
    }
  }

  return {
    async getCandles(symbol, interval) {
      let lastError: unknown
      for (let i = 0; i < chain.length; i++) {
        try {
          return await chain[i].provider.getCandles(symbol, interval)
        } catch (err) {
          lastError = err
          const code = err instanceof MarketDataError ? err.code : 'upstream'
          if (code === 'unknown_symbol' || code === 'unsupported') throw err
          if (i === chain.length - 1) throw err
        }
      }
      throw lastError
    },
  }
}

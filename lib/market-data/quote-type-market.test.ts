import { describe, expect, it } from 'vitest'
import { QUOTE_TYPE_MARKET, type Market } from './types'

// Die Zuordnung steuert, welcher Markt beim Anlegen aus der Watchlist-Suche
// gesetzt wird — und der Markt entscheidet über Kerzenintervalle, Alarmregeln
// und Auflösung. Ein stiller Wechsel hier fällt sonst erst am falschen Chart auf.
describe('QUOTE_TYPE_MARKET', () => {
  const ERLAUBT: Market[] = [
    'aktien',
    'krypto',
    'forex',
    'rohstoffe',
    'etf',
    'optionen',
    'sonstiges',
  ]

  it('liefert ausschließlich Märkte, die die App kennt', () => {
    // Muss zu `VALID_MARKETS` in `app/actions/stocks.ts` passen — ein unbekannter
    // Wert würde dort stillschweigend auf „aktien" zurückfallen.
    for (const markt of Object.values(QUOTE_TYPE_MARKET)) {
      expect(ERLAUBT).toContain(markt)
    }
  })

  it('ordnet die Typen aus der Yahoo-Suche richtig zu', () => {
    expect(QUOTE_TYPE_MARKET.EQUITY).toBe('aktien')
    expect(QUOTE_TYPE_MARKET.ETF).toBe('etf')
    expect(QUOTE_TYPE_MARKET.CRYPTOCURRENCY).toBe('krypto')
    expect(QUOTE_TYPE_MARKET.CURRENCY).toBe('forex')
    expect(QUOTE_TYPE_MARKET.FUTURE).toBe('rohstoffe')
    expect(QUOTE_TYPE_MARKET.OPTION).toBe('optionen')
  })

  it('führt Fonds und Indizes nicht als handelbare Gattung', () => {
    // Ein Investmentfonds ist kein ETF, ein Index keine Aktie. Beide gehören
    // nach „sonstiges", statt eine Handelbarkeit zu behaupten, die es nicht gibt.
    expect(QUOTE_TYPE_MARKET.MUTUALFUND).toBe('sonstiges')
    expect(QUOTE_TYPE_MARKET.INDEX).toBe('sonstiges')
  })
})

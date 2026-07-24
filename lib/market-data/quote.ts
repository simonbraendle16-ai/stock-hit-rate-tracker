// Aktueller Kurs eines Instruments — die letzte Kerze der bereits vorhandenen
// Datenanbindung. Kein neuer Dienst, keine zusätzlichen Kosten: derselbe
// gecachte Getter wie Chart und Sparklines (`getCachedCandles`, 15 Min intraday).
//
// Ehrlichkeitsgebot (Etappe 3): Der Kurs ist NICHT live, sondern der Schluss der
// letzten geladenen Kerze. Deshalb reicht die Funktion den Zeitstempel mit
// heraus — die UI beschriftet sichtbar „Kurs von 14:32". Ein Kurs, der so tut,
// als wäre er live, wäre schlimmer als gar keiner.

import { getCachedCandles } from './cached'
import { Interval, Market } from './index'

export interface Quote {
  /** Schlusskurs der letzten Kerze. */
  price: number
  /** High/Low der letzten Kerze — für den Alert-Abgleich (Intra-Kerzen-Berührung). */
  high: number
  low: number
  /** Unix-Sekunden (UTC) des Kerzenbeginns — Grundlage für „Kurs von …". */
  time: number
  /** Aus welchem Intervall der Kurs stammt (für die Beschriftung). */
  interval: Interval
}

/**
 * Kerzen-Intervall für den Kurs-Snapshot.
 *
 * Bewusst intraday (`1h`): der Schluss der letzten Stundenkerze ist aktuell
 * genug für eine offene Position und wird 15 Minuten gecacht — das schont das
 * Twelve-Data-Gratislimit. Optionen haben keine Gratis-Daten; `resolveProvider`
 * wirft dort 'unsupported', und die UI fällt auf den Chart-Link zurück.
 */
export function quoteInterval(_market: Market): Interval {
  return '1h'
}

/**
 * Aktueller Kurs für ein Symbol. Wirft dieselben `MarketDataError`s wie die
 * Kerzen-Anbindung (rate_limit / unknown_symbol / unsupported / upstream), damit
 * die aufrufende Route/Action sie unverändert behandeln kann.
 */
export async function getCachedQuote(symbol: string, market: Market): Promise<Quote> {
  const interval = quoteInterval(market)
  const candles = await getCachedCandles(symbol, market, interval)
  const last = candles[candles.length - 1]
  if (!last) {
    // getCandles wirft bei leerem Ergebnis bereits; dieser Fall ist die
    // zusätzliche Absicherung, falls ein Provider je ein leeres Array liefert.
    throw new Error(`Keine Kursdaten für „${symbol}“.`)
  }
  return {
    price: last.close,
    high: last.high,
    low: last.low,
    time: last.time,
    interval,
  }
}

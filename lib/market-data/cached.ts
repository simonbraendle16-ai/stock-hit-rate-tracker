import { Interval, Market, MarketDataError } from './index'
import { getStoredCandles, type CandleQueryOptions } from './candle-store'
import { istGueltigesAnbieterSymbol } from './symbol-syntax'

// Intraday 15 min, Daily und größer 12 h. Die Staffel selbst steht seit dem
// Kerzenspeicher in `candle-merge.ts` (`freshnessMs`) — hier bleibt sie nur als
// Auskunft für Aufrufer, die ein Revalidierungsfenster in Sekunden brauchen.
const INTRADAY: Interval[] = ['15min', '30min', '1h', '4h']

export function revalidateFor(interval: Interval): number {
  return INTRADAY.includes(interval) ? 60 * 15 : 60 * 60 * 12
}

/**
 * Gemeinsamer Kerzen-Getter für Charts, Sparklines, Bot-Zwilling und MAE/MFE.
 *
 * **Seit dem Kerzenspeicher (Migration 0027) geht das nicht mehr direkt an den
 * Anbieter**, sondern zuerst in die Datenbank — siehe `candle-store.ts`.
 * Vorher lag hier ein `unstable_cache`: prozessweit, 15 Minuten haltbar, nach
 * jedem Neustart leer. Das genügte, solange nur der aktuelle Ausschnitt
 * gebraucht wurde; beim Replay-Trainer und beim Bot-Zwilling ist die Frage aber
 * eine andere — dort geht es um Kerzen, die der Anbieter GAR NICHT MEHR
 * hergibt (Yahoo liefert 15-Minuten-Kerzen nur 60 Tage weit).
 *
 * Der Name bleibt, damit die bestehenden Aufrufer unverändert gültig sind: Der
 * Vertrag — „gib mir die Kerzen, kümmere dich ums Zwischenspeichern" — ist
 * derselbe, er wird nur jetzt eingelöst statt bloß behauptet.
 *
 * **Die Wache hier ist die letzte Verteidigungslinie, und sie steht mit
 * Absicht an genau dieser Stelle.** Diese Funktion ist laut Projektregel der
 * EINZIGE Weg zu Kerzen — also auch der einzige Ort, an dem sich verhindern
 * lässt, dass ein unaufgelöster Rohticker beim Anbieter landet und, schlimmer,
 * **dauerhaft** im Kerzenspeicher konserviert wird.
 *
 * Warum das nicht theoretisch ist: Unter dem Schlüssel `BTC` lag eine Reihe mit
 * 3.515 Stundenkerzen zwischen 23 und 56 Dollar — ein fremdes Papier, das Yahoo
 * unter diesem Kürzel führt, während Bitcoin bei 65.000 steht. Entstanden ist
 * sie über den bewussten Rückfall auf den Rohticker, und weil der Speicher
 * nichts vergisst, hat der stündliche Sammellauf sie danach immer weiter
 * gepflegt. Ein leerer Chart ist ärgerlich; ein stiller falscher Kurs ist genau
 * das, wogegen diese App gebaut ist.
 */
export function getCachedCandles(
  symbol: string,
  market: Market,
  interval: Interval,
  options?: CandleQueryOptions,
) {
  if (!istGueltigesAnbieterSymbol(symbol)) {
    return Promise.reject(
      new MarketDataError(
        `„${symbol}" ist kein aufgelöstes Anbieter-Symbol — dafür werden keine Kerzen geholt.`,
        'unknown_symbol',
      ),
    )
  }
  return getStoredCandles(symbol, market, interval, options)
}

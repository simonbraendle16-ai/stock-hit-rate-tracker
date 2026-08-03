import { Interval, Market } from './index'
import { getStoredCandles, type CandleQueryOptions } from './candle-store'

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
 */
export function getCachedCandles(
  symbol: string,
  market: Market,
  interval: Interval,
  options?: CandleQueryOptions,
) {
  return getStoredCandles(symbol, market, interval, options)
}

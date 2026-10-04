import type { trade } from '@/lib/db/schema'
import type { TradeEventRow } from '@/lib/trade-events'
import type { Candle } from '@/lib/market-data/types'

export const DEMO_CANDLE_SECONDS = 300
const BOUNDARY_EVENTS = new Set(['eroeffnet', 'nachkauf', 'teilverkauf', 'geschlossen', 'stop_verschoben', 'ziel_geaendert'])

/** Notes do not move the cursor; only an actual position/plan change does. */
export function pruefBeginn(t: typeof trade.$inferSelect, events: TradeEventRow[]) {
  const changed = events.filter((e) => BOUNDARY_EVENTS.has(e.type))
    .reduce((latest, e) => Math.max(latest, new Date(e.at).getTime()), 0)
  return { beginn: new Date(Math.max(
    (t.openedAt ?? t.createdAt).getTime(), changed,
    t.demoCheckedAt?.getTime() ?? 0, t.demoBoundaryAt?.getTime() ?? 0,
  )) }
}

/** Never evaluate an unfinished candle or history from before a manual change. */
export function completedDemoCandles(candles: Candle[], boundary: Date, now: number): Candle[] {
  const first = Math.ceil(boundary.getTime() / (DEMO_CANDLE_SECONDS * 1000)) * DEMO_CANDLE_SECONDS
  const result = candles.filter((c) => c.time >= first && (c.time + DEMO_CANDLE_SECONDS) * 1000 <= now)
  if (result.some((c) => !Number.isFinite(c.high) || !Number.isFinite(c.low) || c.low > c.high)) {
    throw new Error('Ungültige 5-Minuten-Kerze: Prüfstand bleibt unverändert.')
  }
  return result
}

/** Intraday gaps are not trading sessions. Stop before missing candles, never
 * advance across them. Overnight/session gaps are allowed for exchange markets.
 */
export function demoCoveragePrefix(candles: Candle[], previous: Candle | null, boundary: Date, market: string) {
  const since = Math.ceil(boundary.getTime() / (DEMO_CANDLE_SECONDS * 1000)) * DEMO_CANDLE_SECONDS
  let expected = Math.max(previous ? previous.time + DEMO_CANDLE_SECONDS : since, since)
  const usable: Candle[] = []
  for (const candle of candles) {
    const sameDay = Math.floor(candle.time / 86400) === Math.floor(expected / 86400)
    if (candle.time > expected && (!previous && !usable.length || market === 'krypto' || sameDay)) {
      return { usable, gap: true }
    }
    usable.push(candle)
    expected = candle.time + DEMO_CANDLE_SECONDS
  }
  return { usable, gap: false }
}

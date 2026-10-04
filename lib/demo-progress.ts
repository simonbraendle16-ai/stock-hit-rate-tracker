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
export function completedDemoCandles(candles: Candle[], boundary: Date, now: number, candleSeconds = DEMO_CANDLE_SECONDS): Candle[] {
  const first = Math.ceil(boundary.getTime() / (candleSeconds * 1000)) * candleSeconds
  const result = candles.filter((c) => c.time >= first && (c.time + candleSeconds) * 1000 <= now)
  if (result.some((c) => !Number.isFinite(c.high) || !Number.isFinite(c.low) || c.low > c.high)) {
    throw new Error('Ungültige 5-Minuten-Kerze: Prüfstand bleibt unverändert.')
  }
  return result
}

/** Intraday gaps are not trading sessions. Stop before missing candles, never
 * advance across them. Overnight/session gaps are allowed for exchange markets.
 */
export function demoCoveragePrefix(candles: Candle[], previous: Candle | null, boundary: Date, market: string, exchange?: string | null, candleSeconds = DEMO_CANDLE_SECONDS) {
  const since = Math.ceil(boundary.getTime() / (candleSeconds * 1000)) * candleSeconds
  let expected = Math.max(previous ? previous.time + candleSeconds : since, since)
  const usable: Candle[] = []
  for (const candle of candles) {
    const sameDay = Math.floor(candle.time / 86400) === Math.floor(expected / 86400)
    if (candle.time > expected && (!previous && !usable.length || market === 'krypto' || sameDay)
      && (market === 'krypto' || !closedExchangeGap(expected, candle.time, exchange))) {
      return { usable, gap: true }
    }
    usable.push(candle)
    expected = candle.time + candleSeconds
  }
  return { usable, gap: false }
}


const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** Only confirmed exchanges can excuse a gap; intraday missing bars still stop execution. */
export function closedExchangeGap(start: number, end: number, exchange?: string | null): boolean {
  const venue = exchange?.toUpperCase()
  const equities = ['NASDAQ', 'NYSE', 'NMS', 'NGM', 'NCM', 'NYQ', 'NYS', 'XNGS', 'XNYS'].includes(venue ?? '')
  const gold = ['CMX', 'COMEX'].includes(venue ?? '')
  if ((!equities && !gold) || end <= start || end - start > 5 * 86400) return false
  for (let time = start; time < end; time += DEMO_CANDLE_SECONDS) {
    const parts = Object.fromEntries(newYorkClock.formatToParts(new Date(time * 1000)).map((p) => [p.type, p.value]))
    const minutes = Number(parts.hour) * 60 + Number(parts.minute)
    const day = parts.weekday
    const open = equities
      ? day !== 'Sat' && day !== 'Sun' && minutes >= 570 && minutes < 960
      : day !== 'Sat' && !(day === 'Sun' && minutes < 1080) && !(day === 'Fri' && minutes >= 1020)
        && !(minutes >= 1020 && minutes < 1080)
    if (open) return false
  }
  return true
}

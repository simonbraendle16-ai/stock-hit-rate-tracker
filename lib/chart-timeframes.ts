/**
 * Die Zeitebenen des Cockpit-Charts — eine gemeinsame Quelle.
 *
 * Standen bis zum Replay-Trainer nur in `components/chart/price-chart.tsx` und
 * damit in einer Client-Komponente. Seit der Trainer eine Übung serverseitig
 * anlegt (und `/api/candles` die Kerzen einer verdeckten Übung ausliefert,
 * ohne das Symbol zu verraten), braucht auch der Server die Zuordnung
 * Zeitebene → Intervall. Zwei Tabellen wären zwei Wahrheiten darüber, was
 * „4h" bedeutet.
 */

import type { Interval } from './market-data/types'

export const CHART_TIMEFRAMES: Record<string, { interval: Interval; days: number | null }> = {
  '15m': { interval: '15min', days: 3 },
  '30m': { interval: '30min', days: 6 },
  '1h': { interval: '1h', days: 14 },
  '4h': { interval: '4h', days: 60 },
  T: { interval: '1day', days: 365 },
  W: { interval: '1week', days: null },
  M: { interval: '1month', days: null },
}

export type ChartTimeframe = keyof typeof CHART_TIMEFRAMES

/** Die Reihenfolge, in der die Zeitebenen überall angeboten werden. */
export const CHART_TIMEFRAME_IDS = Object.keys(CHART_TIMEFRAMES) as ChartTimeframe[]

export function isChartTimeframe(v: unknown): v is ChartTimeframe {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CHART_TIMEFRAMES, v)
}

/** Zeitebene → Anbieter-Intervall; unbekannte Eingaben fallen auf Tageskerzen. */
export function intervalForTimeframe(tf: string): Interval {
  return isChartTimeframe(tf) ? CHART_TIMEFRAMES[tf].interval : '1day'
}

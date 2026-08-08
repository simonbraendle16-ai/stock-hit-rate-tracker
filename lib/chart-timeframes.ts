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

/**
 * Wie viele Stufen der Kontext über der Arbeitsebene liegt.
 *
 * Zwei und nicht eine: Eine Stufe höher zeigt im Wesentlichen dieselbe
 * Bewegung, nur gröber gezeichnet — das beantwortet die Frage „in welchem
 * übergeordneten Zyklus stehen wir?" nicht. Erst zwei Stufen darüber wird der
 * Abschnitt sichtbar, in dem die Arbeitsebene nur ein Ausschnitt ist.
 * Drei Stufen wären von 15m aus schon der Tageschart und von 1h aus die Woche —
 * dort verliert die Arbeitsebene den Bezug.
 */
export const KONTEXT_STUFEN = 2

/**
 * Die Zeitebene für den Kontext-Chart: zwei Stufen über der Basis.
 *
 * Rein und getestet, weil das eine Entscheidung ist und keine Darstellung — in
 * der Komponente stünde sie als nackte Zahl in einer Indexrechnung, und beim
 * nächsten Eingriff in `CHART_TIMEFRAME_IDS` fiele sie still daneben.
 *
 * Am oberen Ende wird geklemmt statt umgebrochen: Über dem Monat gibt es hier
 * nichts, und eine Übung auf Wochenkerzen bekommt eben den Monat als Kontext.
 * Das ist ehrlicher als so zu tun, als gäbe es eine weitere Ebene.
 */
export function kontextEbene(basis: string): ChartTimeframe {
  const letzte = CHART_TIMEFRAME_IDS[CHART_TIMEFRAME_IDS.length - 1]
  if (!isChartTimeframe(basis)) return letzte
  const i = CHART_TIMEFRAME_IDS.indexOf(basis)
  return CHART_TIMEFRAME_IDS[Math.min(CHART_TIMEFRAME_IDS.length - 1, i + KONTEXT_STUFEN)]
}

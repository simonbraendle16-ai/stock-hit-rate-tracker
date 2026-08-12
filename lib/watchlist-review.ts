// Die Wochenrunde durch die Watchlist.
//
// WARUM
// Bei rund 140 Instrumenten rutscht ohne Buchführung zwangsläufig etwas durch,
// und zwar unbemerkt — genau das, was diese App sonst überall vermeidet. Hier
// steht deshalb nur EINE Auskunft: Wann wurde ein Symbol zuletzt angesehen, und
// ist das länger als eine Woche her?
//
// Bewusst KEINE Bewertung. Es wird nichts prognostiziert, nichts eingeschätzt und
// zu nichts gedrängt — der Douglas-Filter erlaubt, was den Prozess stärkt, und
// verbietet, was Meinungssucht füttert. Ein Haken ist Prozess.
//
// ROLLIEREND, nicht kalendarisch: Fällig ist, was länger als sieben Tage her ist.
// Ein fester Montagsschnitt hätte 140 Symbole an einem Tag auf einen Schlag wieder
// geöffnet — auch die, die man Sonntagabend gerade durchgegangen war.

import { toTradingViewSymbol } from '@/lib/market-data/tradingview-symbol'

/** Eine Woche. Der einzige Takt dieser Datei. */
export const REVIEW_INTERVAL_DAYS = 7

const TAG_MS = 24 * 60 * 60 * 1000
const INTERVALL_MS = REVIEW_INTERVAL_DAYS * TAG_MS

/** Das Wenige, das die Runde von einem Instrument wissen muss. */
export type ReviewFaehig = {
  lastReviewedAt: Date | string | null
  watchlistSection?: string | null
}

/** Aus der Datenbank kommt je nach Weg ein `Date` oder eine Zeichenkette. */
function alsDatum(wert: Date | string | null): Date | null {
  if (wert == null) return null
  const d = wert instanceof Date ? wert : new Date(wert)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Ist dieses Symbol wieder dran?
 *
 * `null` heißt „noch nie angesehen" und ist damit sofort fällig — ein frisch
 * aufgenommener Wert will angeschaut werden.
 *
 * Gerechnet wird in Millisekunden, nicht in Kalendertagen. Über einen
 * Zeitumstellungs-Sonntag hinweg wären „7 Kalendertage" nämlich 167 oder 169
 * Stunden; die Runde soll aber überall gleich lang sein.
 */
export function istFaellig(lastReviewedAt: Date | string | null, jetzt: Date): boolean {
  const d = alsDatum(lastReviewedAt)
  if (d == null) return true
  return jetzt.getTime() - d.getTime() > INTERVALL_MS
}

/**
 * Wie viele volle Tage ist der letzte Blick her? `null`, wenn es keinen gab.
 * Nur für die Beschriftung — die Fälligkeit entscheidet `istFaellig`.
 */
export function tageSeither(lastReviewedAt: Date | string | null, jetzt: Date): number | null {
  const d = alsDatum(lastReviewedAt)
  if (d == null) return null
  return Math.max(0, Math.floor((jetzt.getTime() - d.getTime()) / TAG_MS))
}

export type ReviewStand = { gesamt: number; offen: number }

/** Wie viele Symbole stehen noch aus? */
export function reviewStand(stocks: ReviewFaehig[], jetzt: Date): ReviewStand {
  let offen = 0
  for (const s of stocks) if (istFaellig(s.lastReviewedAt, jetzt)) offen += 1
  return { gesamt: stocks.length, offen }
}

/**
 * Derselbe Stand je Sektion. Bei 140 Symbolen ist die Sektion die Einheit, in der
 * tatsächlich gearbeitet wird — der Gesamtzähler allein sagt nicht, wo man weitermacht.
 *
 * Der Schlüssel ist die Sektion, wie sie am Instrument steht; Symbole ohne Sektion
 * laufen unter `null`. Die Beschriftung („Ohne Sektion") ist Sache der Oberfläche.
 */
export function reviewStandJeSektion(
  stocks: ReviewFaehig[],
  jetzt: Date,
): Map<string | null, ReviewStand> {
  const map = new Map<string | null, ReviewStand>()
  for (const s of stocks) {
    const key = s.watchlistSection ?? null
    const stand = map.get(key) ?? { gesamt: 0, offen: 0 }
    stand.gesamt += 1
    if (istFaellig(s.lastReviewedAt, jetzt)) stand.offen += 1
    map.set(key, stand)
  }
  return map
}

/**
 * Die TradingView-Adresse eines Instruments.
 *
 * Ein hinterlegter Chart-Link ist die ausdrückliche Wahl des Nutzers und wird
 * unverändert benutzt. Sonst wird die Adresse aus `toTradingViewSymbol` gebaut —
 * derselben geprüften Übersetzung, die auch das eingebettete Chart benutzt. Ohne
 * sie bekäme TradingView den Rohticker und rät bei mehrdeutigen Kürzeln daneben.
 */
export function tradingViewUrl(s: {
  ticker: string
  market: string
  chartUrl: string | null
  resolvedExchange?: string | null
}): string {
  if (s.chartUrl) return s.chartUrl
  const symbol = toTradingViewSymbol(s.ticker, s.market, null, s.resolvedExchange ?? null)
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`
}

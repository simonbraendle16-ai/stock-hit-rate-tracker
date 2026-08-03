/**
 * Der rechnende Teil des Kerzenspeichers — rein, ohne Datenbank, testbar.
 *
 * Der Speicher (`candle_cache`) ist die Antwort auf eine harte Grenze: Yahoo
 * gibt 15-Minuten-Kerzen nur 60 Tage weit heraus. Was älter ist, ist beim
 * Anbieter für immer weg — bei uns aber nicht, wenn wir es einmal geholt und
 * behalten haben. Der Vorrat wächst dadurch über das hinaus, was die Quelle
 * überhaupt noch kennt.
 *
 * Zwei Regeln tragen das Ganze:
 *
 * 1. **Die letzte Kerze einer Reihe ist unfertig.** Sie läuft noch; ihr Hoch,
 *    Tief, Schluss und Volumen ändern sich bis zum Ende des Intervalls. Neue
 *    Daten müssen sie deshalb überschreiben.
 * 2. **Abgeschlossene Kerzen ändern sich nicht mehr** — und wenn ein Anbieter
 *    doch etwas anderes liefert (Korrektur, Split), ist seine neuere Angabe die
 *    richtige. Deshalb gewinnt bei gleichem Zeitstempel immer der neue Satz.
 *    Was der neue Satz gar nicht enthält, bleibt unangetastet: Genau das ist
 *    die alte Historie, die der Anbieter nicht mehr hergibt.
 */

import type { Candle, Interval } from './types'

/** Länge eines Intervalls in Sekunden — für Lücken- und Frischeprüfungen. */
export const INTERVAL_SECONDS: Record<Interval, number> = {
  '15min': 15 * 60,
  '30min': 30 * 60,
  '1h': 60 * 60,
  '4h': 4 * 60 * 60,
  '1day': 24 * 60 * 60,
  '1week': 7 * 24 * 60 * 60,
  // Kalendermonate sind ungleich lang; 30 Tage genügen als grobes Maß.
  '1month': 30 * 24 * 60 * 60,
}

/**
 * Führt gespeicherte und frisch geholte Kerzen zusammen.
 *
 * Ergebnis ist immer nach Zeit sortiert und ohne Dubletten. Bei gleichem
 * Zeitstempel gewinnt `frisch` — siehe Regel 1 und 2 oben.
 */
export function mergeCandles(gespeichert: Candle[], frisch: Candle[]): Candle[] {
  if (frisch.length === 0) return [...gespeichert].sort((a, b) => a.time - b.time)
  if (gespeichert.length === 0) return [...frisch].sort((a, b) => a.time - b.time)

  const map = new Map<number, Candle>()
  for (const c of gespeichert) map.set(c.time, c)
  for (const c of frisch) map.set(c.time, c)

  return [...map.values()].sort((a, b) => a.time - b.time)
}

/**
 * Welche der frischen Kerzen tatsächlich geschrieben werden müssen.
 *
 * Ohne diese Auswahl schriebe jeder Abruf alle paar tausend Zeilen neu, obwohl
 * sich fast nie mehr als die letzten ein, zwei Kerzen ändern. Geschrieben wird
 * nur, was neu ist oder sich in einem Feld unterscheidet.
 */
export function candlesToWrite(gespeichert: Candle[], frisch: Candle[]): Candle[] {
  const alt = new Map<number, Candle>()
  for (const c of gespeichert) alt.set(c.time, c)

  return frisch.filter((c) => {
    const vorhanden = alt.get(c.time)
    if (!vorhanden) return true
    return (
      vorhanden.open !== c.open ||
      vorhanden.high !== c.high ||
      vorhanden.low !== c.low ||
      vorhanden.close !== c.close ||
      vorhanden.volume !== c.volume
    )
  })
}

export interface SeriesCoverage {
  /** Unix-Sekunden der ältesten gespeicherten Kerze. */
  firstTime: number | null
  /** Unix-Sekunden der jüngsten gespeicherten Kerze. */
  lastTime: number | null
  count: number
}

export function coverageOf(candles: Candle[]): SeriesCoverage {
  if (candles.length === 0) return { firstTime: null, lastTime: null, count: 0 }
  let min = candles[0].time
  let max = candles[0].time
  for (const c of candles) {
    if (c.time < min) min = c.time
    if (c.time > max) max = c.time
  }
  return { firstTime: min, lastTime: max, count: candles.length }
}

/**
 * Wie lange eine gespeicherte Reihe als frisch gilt.
 *
 * Dieselbe Staffel wie bisher im Zwischenspeicher: Intraday 15 Minuten, alles
 * darüber 12 Stunden. Sie ist bewusst nicht an die Intervalllänge gekoppelt —
 * eine Tageskerze ändert sich zwar den ganzen Tag, aber ein Journal, das
 * Kurse mit Zeitstempel zeigt, braucht sie nicht minütlich.
 */
export function freshnessMs(interval: Interval): number {
  const intraday: Interval[] = ['15min', '30min', '1h', '4h']
  return intraday.includes(interval) ? 15 * 60 * 1000 : 12 * 60 * 60 * 1000
}

export function isFresh(interval: Interval, fetchedAt: Date | null, now = new Date()): boolean {
  if (!fetchedAt) return false
  return now.getTime() - fetchedAt.getTime() < freshnessMs(interval)
}

/**
 * Die letzten `limit` Kerzen — der Ausschnitt, der ausgeliefert wird.
 * Ein `limit` von 0 oder darunter liefert alles.
 */
export function takeLast(candles: Candle[], limit: number): Candle[] {
  if (!Number.isFinite(limit) || limit <= 0 || candles.length <= limit) return candles
  return candles.slice(-limit)
}

/**
 * Reihen nach Dringlichkeit ordnen — der Rotationsschlüssel des Sammellaufs.
 *
 * Vorne steht, was am längsten nicht geholt wurde; noch nie geholte Reihen
 * zuerst. Ohne diese Ordnung bekäme bei einem Abrufbudget immer dieselbe
 * Handvoll Symbole frische Kerzen und der Rest nie welche.
 */
export function orderByStaleness<T extends { fetchedAt: Date | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = a.fetchedAt ? a.fetchedAt.getTime() : -1
    const tb = b.fetchedAt ? b.fetchedAt.getTime() : -1
    return ta - tb
  })
}

/**
 * Ist diese Reihe für den Sammellauf fällig?
 *
 * Gestaffelt nach Zeitebene: Bei 15-/30-Minuten- und Stundenkerzen läuft die
 * Historie beim Anbieter davon (60 Tage bzw. 2 Jahre), die holen wir täglich.
 * Tages-, Wochen- und Monatskerzen liefert Yahoo jahrzehntelang — die einmal
 * pro Woche anzufassen genügt, und jede zusätzliche Anfrage ginge vom Budget
 * der knappen Reihen ab.
 */
export function collectIntervalMs(interval: Interval): number {
  const taeglich: Interval[] = ['15min', '30min', '1h']
  return taeglich.includes(interval) ? 20 * 60 * 60 * 1000 : 6.5 * 24 * 60 * 60 * 1000
}

export function isDueForCollection(
  interval: Interval,
  fetchedAt: Date | null,
  now = new Date(),
): boolean {
  if (!fetchedAt) return true
  return now.getTime() - fetchedAt.getTime() >= collectIntervalMs(interval)
}

export interface IntervalCoverage {
  interval: Interval
  /** Wie weit die längste gespeicherte Reihe zurückreicht, in Tagen. */
  days: number
  /** Über wie viele Symbole überhaupt etwas gespeichert ist. */
  symbols: number
  /** Kerzen insgesamt in dieser Zeitebene. */
  candles: number
}

/**
 * Was der Speicher je Zeitebene tatsächlich hergibt — die Grundlage für die
 * Auskunft im Trainer.
 *
 * Genommen wird die **längste** Reihe, nicht der Durchschnitt: Die Frage lautet
 * „wie weit kann ich auf dieser Zeitebene üben", und das entscheidet das beste
 * Instrument, nicht das schlechteste.
 */
export function summarizeCoverage(
  rows: { interval: string; firstTime: number | null; lastTime: number | null; candleCount: number }[],
  intervals: Interval[],
): IntervalCoverage[] {
  return intervals.map((interval) => {
    const eigene = rows.filter((r) => r.interval === interval && r.candleCount > 0)
    let days = 0
    let candles = 0
    for (const r of eigene) {
      candles += r.candleCount
      if (r.firstTime != null && r.lastTime != null) {
        const spanne = (r.lastTime - r.firstTime) / 86400
        if (spanne > days) days = spanne
      }
    }
    return { interval, days: Math.round(days), symbols: eigene.length, candles }
  })
}

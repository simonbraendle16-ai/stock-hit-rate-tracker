/**
 * Der Kerzenspeicher (Migration 0027) — Lesen, Nachladen, Fortschreiben.
 *
 * Hier liegt der Datenbankteil; alles, was sich rechnen lässt, steht rein und
 * getestet in `candle-merge.ts`.
 *
 * Der Ablauf ist bewusst genau einer, damit es nicht zwei Wahrheiten darüber
 * gibt, woher Kerzen kommen:
 *
 *   1. Gespeicherte Reihe lesen.
 *   2. Ist sie frisch (15 Min intraday, 12 h darüber), wird sie ausgeliefert —
 *      **ohne einen einzigen Netzabruf**.
 *   3. Sonst beim Anbieter holen, mit dem Bestand zusammenführen, nur die
 *      tatsächlich veränderten Zeilen schreiben, Reihe fortschreiben.
 *   4. Scheitert der Anbieter und es liegen Kerzen vor, kommen die Kerzen.
 *      Ein Ausfall bedeutet einen alten Stand, keinen leeren Chart.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { candleCache, candleSeries } from '@/lib/db/schema'
import { resolveProvider } from './index'
import type { Candle, Interval, Market } from './types'
import { DELIVERY_LIMIT, MAX_DELIVERY_LIMIT, MarketDataError } from './types'
import { candlesToWrite, coverageOf, isFresh, mergeCandles, takeLast } from './candle-merge'

/**
 * Auf so viele Zeilen wird eine Schreiboperation aufgeteilt.
 *
 * Die Grenze ist Postgres' Parameterzahl je Anweisung (65.535); bei acht
 * Spalten je Kerze passen rechnerisch gut 8.000 Zeilen, 2.000 lässt reichlich
 * Luft. Kleiner zu wählen kostet spürbar: Der erste Sammellauf schrieb rund
 * 300.000 Kerzen — in 500er-Blöcken sind das 600 Hin- und Rückwege zu einer
 * entfernten Datenbank.
 */
const CHUNK = 2000

export async function readStoredCandles(
  symbol: string,
  interval: Interval,
): Promise<Candle[]> {
  const rows = await db
    .select({
      time: candleCache.time,
      open: candleCache.open,
      high: candleCache.high,
      low: candleCache.low,
      close: candleCache.close,
      volume: candleCache.volume,
    })
    .from(candleCache)
    .where(and(eq(candleCache.symbol, symbol), eq(candleCache.interval, interval)))
    .orderBy(asc(candleCache.time))
  return rows
}

async function readSeries(symbol: string, interval: Interval) {
  const [row] = await db
    .select()
    .from(candleSeries)
    .where(and(eq(candleSeries.symbol, symbol), eq(candleSeries.interval, interval)))
  return row ?? null
}

/**
 * Kerzen schreiben. `candlesToWrite` hat vorher aussortiert, was sich nicht
 * geändert hat — meist bleiben ein, zwei Zeilen übrig statt einiger tausend.
 */
async function writeCandles(
  symbol: string,
  interval: Interval,
  candles: Candle[],
): Promise<void> {
  for (let i = 0; i < candles.length; i += CHUNK) {
    const teil = candles.slice(i, i + CHUNK)
    await db
      .insert(candleCache)
      .values(
        teil.map((c) => ({
          symbol,
          interval,
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      )
      // Die laufende Kerze ändert sich bis zum Ende ihres Intervalls, und ein
      // Anbieter darf ältere korrigieren — der neuere Satz gewinnt.
      .onConflictDoUpdate({
        target: [candleCache.symbol, candleCache.interval, candleCache.time],
        set: {
          open: sqlExcluded('open'),
          high: sqlExcluded('high'),
          low: sqlExcluded('low'),
          close: sqlExcluded('close'),
          volume: sqlExcluded('volume'),
        },
      })
  }
}

// Kleiner Helfer, damit `excluded.<spalte>` nicht fünfmal als Rohtext dasteht.
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`)
}

async function writeSeries(
  symbol: string,
  interval: Interval,
  market: Market | null,
  alle: Candle[],
  fehler: string | null,
): Promise<void> {
  const abdeckung = coverageOf(alle)
  const jetzt = new Date()

  await db
    .insert(candleSeries)
    .values({
      symbol,
      interval,
      market,
      firstTime: abdeckung.firstTime,
      lastTime: abdeckung.lastTime,
      candleCount: abdeckung.count,
      fetchedAt: fehler ? null : jetzt,
      lastError: fehler,
      failCount: fehler ? 1 : 0,
    })
    .onConflictDoUpdate({
      target: [candleSeries.symbol, candleSeries.interval],
      set: fehler
        ? {
            lastError: fehler,
            failCount: sql`${candleSeries.failCount} + 1`,
          }
        : {
            market: market ?? sql`${candleSeries.market}`,
            firstTime: abdeckung.firstTime,
            lastTime: abdeckung.lastTime,
            candleCount: abdeckung.count,
            fetchedAt: jetzt,
            lastError: null,
            failCount: 0,
          },
    })
}

export interface CandleQueryOptions {
  /** Wie viele Kerzen ausgeliefert werden. Ohne Angabe die Vorgabe der Zeitebene. */
  limit?: number
  /**
   * Nur lesen, nie nachladen. Der Sammellauf benutzt das nicht — wohl aber
   * Auswertungen, die viele Symbole hintereinander anfassen und dabei kein
   * Netz anstoßen sollen.
   */
  storedOnly?: boolean
  /**
   * Nur Kerzen VOR diesem Zeitpunkt (Unix-Sekunden, exklusiv) — für das
   * Nachladen nach links am linken Chartrand.
   *
   * Ein solcher Abruf geht **nie** an den Anbieter, und das ist keine
   * Sparmaßnahme: Yahoo liefert immer das jüngste Fenster seines Intervalls.
   * Eine Frage nach älteren Kerzen kann er gar nicht beantworten — ein Abruf
   * brächte nur wieder die neuesten und ließe den Aufrufer glauben, er habe
   * nachgeladen. Was weiter zurück liegt, liegt im Kerzenspeicher oder nirgends.
   */
  before?: number
}

/**
 * Der eine Weg zu Kerzen. Ersetzt den früheren Prozess-Zwischenspeicher:
 * Der hielt 15 Minuten und war nach jedem Neustart leer, dieser hier hält
 * dauerhaft und wächst über das Fenster des Anbieters hinaus.
 */
export async function getStoredCandles(
  symbol: string,
  market: Market,
  interval: Interval,
  options: CandleQueryOptions = {},
): Promise<Candle[]> {
  const limit = Math.min(
    MAX_DELIVERY_LIMIT,
    options.limit && options.limit > 0 ? options.limit : DELIVERY_LIMIT[interval],
  )

  const [gespeichert, serie] = await Promise.all([
    readStoredCandles(symbol, interval),
    readSeries(symbol, interval),
  ])

  // Blick nach hinten: was da ist, sonst nichts. Siehe `before` oben — der
  // Anbieter hat zu dieser Frage nichts beizutragen.
  if (options.before != null && Number.isFinite(options.before)) {
    const grenze = Math.floor(options.before)
    return takeLast(
      gespeichert.filter((c) => c.time < grenze),
      limit,
    )
  }

  if (options.storedOnly) return takeLast(gespeichert, limit)

  if (gespeichert.length > 0 && isFresh(interval, serie?.fetchedAt ?? null)) {
    return takeLast(gespeichert, limit)
  }

  try {
    const frisch = await resolveProvider(market).getCandles(symbol, interval)
    const zuSchreiben = candlesToWrite(gespeichert, frisch)
    const alle = mergeCandles(gespeichert, frisch)

    if (zuSchreiben.length > 0) await writeCandles(symbol, interval, zuSchreiben)
    await writeSeries(symbol, interval, market, alle, null)

    return takeLast(alle, limit)
  } catch (err) {
    const meldung = err instanceof Error ? err.message : 'Unbekannter Fehler'
    // Den Fehlschlag festhalten, aber die Reihe nicht als „geholt" markieren.
    await writeSeries(symbol, interval, market, gespeichert, meldung).catch(() => {})

    // Ein Anbieterausfall darf einen vorhandenen Verlauf nicht verdecken —
    // dieselbe Haltung wie beim Kurs: lieber ein alter Stand als ein leeres
    // Feld. Nur wenn wirklich nichts da ist, geht der Fehler nach oben.
    if (gespeichert.length > 0) return takeLast(gespeichert, limit)
    throw err instanceof MarketDataError
      ? err
      : new MarketDataError('Kursdaten konnten nicht geladen werden.', 'upstream')
  }
}

/** Abdeckung mehrerer Reihen auf einmal — für die Anzeige im Trainer. */
export async function getSeriesCoverage(
  symbols: string[],
  intervals: Interval[],
): Promise<
  {
    symbol: string
    interval: string
    firstTime: number | null
    lastTime: number | null
    candleCount: number
    fetchedAt: Date | null
  }[]
> {
  if (symbols.length === 0 || intervals.length === 0) return []
  return db
    .select({
      symbol: candleSeries.symbol,
      interval: candleSeries.interval,
      firstTime: candleSeries.firstTime,
      lastTime: candleSeries.lastTime,
      candleCount: candleSeries.candleCount,
      fetchedAt: candleSeries.fetchedAt,
    })
    .from(candleSeries)
    .where(
      and(
        inArray(candleSeries.symbol, symbols),
        inArray(candleSeries.interval, intervals as unknown as string[]),
      ),
    )
}

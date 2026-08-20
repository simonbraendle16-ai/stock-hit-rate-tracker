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

import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { candleCache, candleSeries } from '@/lib/db/schema'
import { resolveProvider } from './index'
import type { Candle, Interval, Market } from './types'
import {
  DELIVERY_LIMIT,
  MAX_DELIVERY_LIMIT,
  MarketDataError,
  retentionLimit,
  type SammelStufe,
} from './types'
import type { SeriesCoverage } from './candle-merge'
import { candlesToWrite, isFresh, mergeCandles, takeLast } from './candle-merge'

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

/** Womit ein Lesevorgang eingegrenzt wird — siehe `readStoredCandles`. */
interface StoredReadOptions {
  /**
   * Nur die jüngsten `limit` Kerzen — **Pflichtangabe**.
   *
   * Absichtlich nicht optional: Ein weggelassenes Limit hat diese Datenbank
   * schon zweimal abgeschaltet. Wer hier nichts angibt, soll beim Typecheck
   * scheitern und nicht am Monatsende auf der Rechnung. Nach oben wird auf
   * `MAX_DELIVERY_LIMIT` geklemmt.
   */
  limit: number
  /** Nur Kerzen VOR diesem Zeitpunkt (Unix-Sekunden). */
  before?: number
  /** Nur Kerzen AB diesem Zeitpunkt (Unix-Sekunden, einschließlich). */
  since?: number
}

/**
 * Kerzen aus dem Speicher lesen — **mit der Mengenbegrenzung im SQL**.
 *
 * Das war der teuerste Fehler dieser Datei: Bis hierher las diese Funktion
 * IMMER die vollständige Reihe und ließ erst `takeLast()` in JavaScript davon
 * übrig, was gebraucht wurde. Für den Chart hieß das rund 900 Kerzen aus
 * 17.000 gelesenen; für den Kurs-Snapshot, der nur die LETZTE Kerze braucht,
 * wurden dieselben 17.000 übertragen — und das alle fünf Minuten je Alarm,
 * angestoßen vom Takt in `.github/workflows/check-alerts.yml`. So sind bei Neon
 * 5 GB Netzwerk-Transfer in wenigen Wochen verbraucht worden, bis die Datenbank
 * abgeschaltet wurde. Supabase hat dasselbe Limit; die Begrenzung gehört
 * deshalb dorthin, wo sie Übertragung spart, und das ist die Datenbank.
 *
 * `ORDER BY time DESC LIMIT n` liest die jüngsten Kerzen, das Umdrehen danach
 * stellt die aufsteigende Reihenfolge her, auf die sich alle Aufrufer verlassen.
 *
 * Es gibt hier **keinen unbegrenzten Pfad mehr**. Den gab es bis zum 17.08.2026
 * noch für Aufrufe ohne `limit` — und genau den traf das Vergleichsfenster
 * weiter unten, mit zuletzt 3.518 Zeilen je Aufruf und 31,8 Mio Zeilen in
 * einem Abrechnungszyklus. Ein Deckel, den ein Aufrufer umgehen kann, ist
 * keiner: `limit` ist deshalb Pflicht und wird auf `MAX_DELIVERY_LIMIT`
 * geklemmt.
 */
export async function readStoredCandles(
  symbol: string,
  interval: Interval,
  options: StoredReadOptions,
): Promise<Candle[]> {
  const bedingungen = [eq(candleCache.symbol, symbol), eq(candleCache.interval, interval)]
  if (options.before != null && Number.isFinite(options.before)) {
    bedingungen.push(lt(candleCache.time, Math.floor(options.before)))
  }
  if (options.since != null && Number.isFinite(options.since)) {
    bedingungen.push(gte(candleCache.time, Math.floor(options.since)))
  }

  const spalten = {
    time: candleCache.time,
    open: candleCache.open,
    high: candleCache.high,
    low: candleCache.low,
    close: candleCache.close,
    volume: candleCache.volume,
  }
  // Der Typecheck verlangt ein `limit`; diese Klemme fängt ab, was ihn umgeht
  // (JS-Aufrufer, `any`, ein durchgereichter `NaN`). Der Rückfall ist der harte
  // Deckel, nicht „unbegrenzt" — ein fehlender Wert darf nie mehr die ganze
  // Reihe bedeuten.
  const gueltig = Number.isFinite(options.limit) && options.limit > 0
  const limit = gueltig
    ? Math.min(MAX_DELIVERY_LIMIT, Math.floor(options.limit))
    : MAX_DELIVERY_LIMIT

  const rows = await db
    .select(spalten)
    .from(candleCache)
    .where(and(...bedingungen))
    .orderBy(desc(candleCache.time))
    .limit(limit)
  return rows.reverse()
}

/**
 * Abdeckung einer Reihe als Aggregat — `min`, `max`, `count` rechnet Postgres.
 *
 * Vorher lief das über `coverageOf()` in JavaScript, was voraussetzte, dass die
 * KOMPLETTE Reihe vorher durch die Leitung gegangen war. Genau diese Annahme
 * fällt mit der Begrenzung oben weg. Drei Zahlen zu holen ist ohnehin billiger,
 * als Zehntausende Zeilen zu holen, um sie selbst abzuzählen.
 */
async function readCoverage(symbol: string, interval: Interval): Promise<SeriesCoverage> {
  const [row] = await db
    .select({
      firstTime: sql<number | null>`min(${candleCache.time})`,
      lastTime: sql<number | null>`max(${candleCache.time})`,
      count: sql<number>`count(*)::int`,
    })
    .from(candleCache)
    .where(and(eq(candleCache.symbol, symbol), eq(candleCache.interval, interval)))

  return {
    firstTime: row?.firstTime ?? null,
    lastTime: row?.lastTime ?? null,
    count: row?.count ?? 0,
  }
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

/**
 * Die Reihe fortschreiben.
 *
 * Nimmt die Abdeckung als fertige Zahlen entgegen (aus `readCoverage`), statt
 * sie sich aus einem vollständigen Kerzen-Array zu rechnen — das Array gibt es
 * seit der SQL-Begrenzung in `readStoredCandles` bewusst nicht mehr.
 */
async function writeSeries(
  symbol: string,
  interval: Interval,
  market: Market | null,
  abdeckung: SeriesCoverage,
  fehler: string | null,
): Promise<void> {
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

  // Blick nach hinten: was da ist, sonst nichts. Siehe `before` oben — der
  // Anbieter hat zu dieser Frage nichts beizutragen. Die Grenze steht jetzt im
  // SQL, statt eine ganze Reihe zu holen und sie hier wegzufiltern.
  if (options.before != null && Number.isFinite(options.before)) {
    return readStoredCandles(symbol, interval, { before: options.before, limit })
  }

  // Ab hier wird höchstens `limit` gelesen. Das genügt für ALLE verbleibenden
  // Wege: Was ausgeliefert wird, sind immer die jüngsten `limit` Kerzen — und
  // die können nur aus den jüngsten `limit` gespeicherten stammen oder aus dem
  // frischen Satz des Anbieters, der ohnehin am aktuellen Rand liegt.
  const [schwanz, serie] = await Promise.all([
    readStoredCandles(symbol, interval, { limit }),
    readSeries(symbol, interval),
  ])

  if (options.storedOnly) return schwanz

  if (schwanz.length > 0 && isFresh(interval, serie?.fetchedAt ?? null)) {
    return schwanz
  }

  try {
    const frisch = await resolveProvider(market).getCandles(symbol, interval)

    // Vergleichsfenster für den Abgleich: nur der Zeitraum, den der Anbieter
    // überhaupt liefert. Ältere gespeicherte Kerzen können mit keiner frischen
    // Kerze kollidieren — sie zu laden wäre genau die Verschwendung, die diese
    // Datenbank abgeschaltet hat. Ohne frische Kerzen entfällt der Abgleich ganz.
    //
    // Der `since`-Zeitpunkt allein genügte dafür nicht: Er begrenzt den Zeitraum,
    // aber nicht die Menge. Lieferte der Anbieter eine lange Reihe, zog ein
    // einzelner Aufruf mehrere tausend Kerzen — gemessen ⌀ 3.518. Mehr Zeilen,
    // als der Anbieter überhaupt geschickt hat, können mit nichts kollidieren;
    // der Puffer deckt Zeitzonen- und Randfälle ab.
    const vergleichsfenster = frisch.length
      ? await readStoredCandles(symbol, interval, {
          since: Math.min(...frisch.map((c) => c.time)),
          limit: frisch.length + 50,
        })
      : []

    const zuSchreiben = candlesToWrite(vergleichsfenster, frisch)
    if (zuSchreiben.length > 0) await writeCandles(symbol, interval, zuSchreiben)

    // Die Abdeckung erst NACH dem Schreiben erheben, und als Aggregat aus der
    // Datenbank — sie soll die ganze Reihe beschreiben, nicht nur das Fenster,
    // das wir gerade in der Hand hatten.
    await writeSeries(symbol, interval, market, await readCoverage(symbol, interval), null)

    return takeLast(mergeCandles(schwanz, frisch), limit)
  } catch (err) {
    const meldung = err instanceof Error ? err.message : 'Unbekannter Fehler'
    // Den Fehlschlag festhalten, aber die Reihe nicht als „geholt" markieren.
    // Die Abdeckung bleibt dabei unangetastet — der Fehlerzweig von
    // `writeSeries` schreibt ohnehin nur `lastError` und `failCount` fort.
    await writeSeries(
      symbol,
      interval,
      market,
      { firstTime: null, lastTime: null, count: 0 },
      meldung,
    ).catch(() => {})

    // Ein Anbieterausfall darf einen vorhandenen Verlauf nicht verdecken —
    // dieselbe Haltung wie beim Kurs: lieber ein alter Stand als ein leeres
    // Feld. Nur wenn wirklich nichts da ist, geht der Fehler nach oben.
    if (schwanz.length > 0) return schwanz
    throw err instanceof MarketDataError
      ? err
      : new MarketDataError('Kursdaten konnten nicht geladen werden.', 'upstream')
  }
}

/**
 * Eine Reihe auf ihre Aufbewahrungsgrenze zurückschneiden — die Grenze gegen
 * das 500-MB-Speicherlimit des Gratistarifs.
 *
 * Die Grenze hängt an der **Sammelstufe** des Instruments (`retentionLimit`):
 * Wo gehandelt wird, liegt mehr Historie; ein ungenutztes Instrument bekommt
 * nur den Rumpf. Ohne bekannte Stufe gilt die großzügigste — wer die Stufe
 * nicht kennt, darf nicht löschen.
 *
 * Liefert `retentionLimit` `null`, gehört die Ebene dieser Stufe gar nicht.
 * Dann wird hier trotzdem **nichts** gelöscht: Das Abräumen ganzer Ebenen ist
 * Sache von `scripts/apply-retention.mjs`, wo es angesagt und zählbar
 * geschieht. Ein Sammellauf, der nebenbei ganze Reihen tilgt, wäre eine
 * Überraschung an der falschen Stelle.
 *
 * Behalten werden immer die JÜNGSTEN Kerzen; der Schnitt liegt am alten Ende.
 * Der Grenzwert wird dafür in einer Unterabfrage bestimmt (`OFFSET n-1 LIMIT 1`)
 * statt Zeilen einzeln zu zählen — Postgres läuft dafür den Primärschlüssel
 * rückwärts und kommt ohne vollen Durchlauf aus.
 *
 * Das `-1` ist nicht kosmetisch: `OFFSET grenze` trifft die (grenze+1)-te Kerze,
 * und da alles ÄLTERE gelöscht wird, blieben grenze+1 Kerzen stehen. Gemessen
 * gegen die echte Datenbank: 5001 statt 5000. Eine Konstante namens
 * `RETENTION_LIMIT` muss halten, was ihr Name sagt.
 *
 * Liegt die Reihe unter der Grenze, liefert die Unterabfrage NULL und der
 * Vergleich `time < NULL` trifft keine Zeile — dann passiert schlicht nichts.
 *
 * Gibt die Anzahl gelöschter Kerzen zurück, damit der Sammellauf sie protokollieren
 * kann. Ein Aufräumen, das niemand sieht, ist von einem ausgefallenen nicht zu
 * unterscheiden.
 */
export async function pruneStoredCandles(
  symbol: string,
  interval: Interval,
  stufe: SammelStufe = 'A',
): Promise<number> {
  const grenze = retentionLimit(interval, stufe)
  if (grenze == null || grenze <= 0) return 0

  const ergebnis = await db.execute(sql`
    DELETE FROM ${candleCache}
    WHERE ${candleCache.symbol} = ${symbol}
      AND ${candleCache.interval} = ${interval}
      AND ${candleCache.time} < (
        SELECT c."time" FROM ${candleCache} c
        WHERE c."symbol" = ${symbol} AND c."interval" = ${interval}
        ORDER BY c."time" DESC
        OFFSET ${grenze - 1} LIMIT 1
      )
  `)
  const geloescht = ergebnis.rowCount ?? 0
  if (geloescht === 0) return 0

  // Die Reihe beschreibt jetzt etwas anderes als vorher. Bliebe `candleCount`
  // stehen, stünde in der Datenbank eine plausible falsche Zahl — genau das,
  // was dieses Projekt nicht duldet. `fetchedAt` und `lastError` bleiben dabei
  // unangetastet: Aufräumen ist kein Anbieterabruf und darf die Frischeprüfung
  // nicht beeinflussen.
  const abdeckung = await readCoverage(symbol, interval)
  await db
    .update(candleSeries)
    .set({
      firstTime: abdeckung.firstTime,
      lastTime: abdeckung.lastTime,
      candleCount: abdeckung.count,
    })
    .where(and(eq(candleSeries.symbol, symbol), eq(candleSeries.interval, interval)))

  return geloescht
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

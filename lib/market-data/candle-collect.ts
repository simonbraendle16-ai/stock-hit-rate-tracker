/**
 * Der Sammellauf des Kerzenspeichers.
 *
 * Er füllt den Speicher auch dann, wenn niemand einen Chart öffnet — und das
 * ist der Punkt: Ein Vorrat, der nur beim Hinsehen wächst, hat genau dort
 * Lücken, wo man länger nicht hingesehen hat. Bei 15-Minuten-Kerzen reicht ein
 * Blick alle 60 Tage; wer ein Instrument ein Quartal ruhen lässt, verliert das
 * Quartal für immer.
 *
 * Drei Entscheidungen tragen den Lauf:
 *
 * **Budget.** Yahoo kennt für Kerzen keinen Sammelabruf — jede Reihe ist eine
 * Anfrage. Rund neunzig Instrumente mal sieben Zeitebenen wären über sechshundert
 * Abrufe am Stück; das dauert Minuten und lädt geradezu zur Drosselung ein.
 * Ein Lauf nimmt deshalb höchstens `MAX_FETCHES_PER_RUN` Reihen.
 *
 * **Rotation.** Damit das Budget nicht immer denselben Reihen zugutekommt, wird
 * nach „am längsten nicht geholt" geordnet (`orderByStaleness`). Noch nie
 * geholte Reihen stehen vorn.
 *
 * **Staffel.** 15m/30m/1h laufen dem Anbieter davon und werden täglich geholt;
 * Tages-, Wochen- und Monatskerzen liefert Yahoo jahrzehntelang, die genügen
 * wöchentlich (`isDueForCollection`). Jede unnötige Anfrage ginge vom Budget der
 * knappen Reihen ab.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { candleCollectRun, candleSeries, stock } from '@/lib/db/schema'
import type { Interval, Market } from './types'
import { getStoredCandles } from './candle-store'
import { isDueForCollection, orderByStaleness } from './candle-merge'

/** Höchstzahl an Anbieter-Abrufen je Lauf. */
export const MAX_FETCHES_PER_RUN = 150

/**
 * Zeitbudget je Lauf — die eigentliche Bremse.
 *
 * Auf Vercel bricht eine Route nach `maxDuration` (60 s) ab, und zwar mitten
 * im Schreiben: Der Lauf stünde dann ohne `finishedAt` in der Tabelle und
 * niemand wüsste, wie weit er gekommen ist. Ein Lauf hört deshalb von SELBST
 * auf, bevor die Grenze erreicht ist, und schreibt sein Ergebnis. Was liegen
 * bleibt, holt der nächste Lauf — die Rotation nach „am längsten nicht geholt"
 * sorgt dafür, dass es dieselben Reihen nicht zweimal trifft.
 *
 * Gemessen: 150 Reihen brauchten deutlich über zwei Minuten (der erste Lauf
 * schrieb dabei 299.133 Kerzen). Anzahl allein ist also kein brauchbares Maß —
 * eine Krypto-Stundenreihe über zwei Jahre ist 17.000 Kerzen, eine
 * Monatsreihe 160.
 */
export const TIME_BUDGET_MS = 45 * 1000

/**
 * So oft darf ein Lauf überhaupt stattfinden — der Takt ruft alle fünf Minuten
 * an. Eine Stunde, nicht mehr: Bei rund 90 Instrumenten sind 637 Reihen zu
 * füllen, und mit einem Zeitbudget von 45 Sekunden schafft ein Lauf nur einen
 * Teil davon. Stündlich ist der erste vollständige Durchgang nach gut einem
 * Tag fertig, danach reicht der Takt bequem für die täglich fälligen Reihen.
 */
export const RUN_INTERVAL_MS = 60 * 60 * 1000

/** Alle Zeitebenen, in der Reihenfolge ihrer Dringlichkeit. */
export const COLLECTED_INTERVALS: Interval[] = [
  '15min',
  '30min',
  '1h',
  '4h',
  '1day',
  '1week',
  '1month',
]

export interface CollectReport {
  ran: boolean
  /** Grund, wenn nicht gelaufen (z. B. noch nicht fällig). */
  skipped: string | null
  seriesDue: number
  seriesFetched: number
  seriesFailed: number
  candlesAdded: number
  error: string | null
}

/** Wann der letzte Lauf war — die Grundlage der Fälligkeitsprüfung. */
export async function lastCollectRun(): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: candleCollectRun.startedAt })
    .from(candleCollectRun)
    .orderBy(desc(candleCollectRun.startedAt))
    .limit(1)
  return row?.startedAt ?? null
}

/**
 * Ein Sammellauf.
 *
 * Sitzungsfrei wie `runAlertCheck` — der Takt kommt von außen und gehört
 * keinem Nutzer. Gesammelt wird über ALLE Instrumente aller Nutzer, weil eine
 * Kerze ohnehin für alle dieselbe ist (der Speicher hat kein `userId`).
 */
export async function runCandleCollect(options: {
  trigger?: 'cron' | 'manual'
  /** Fälligkeitsprüfung überspringen (Knopf „jetzt sammeln"). */
  force?: boolean
  maxFetches?: number
  /** Zeitbudget in Millisekunden; ohne Angabe `TIME_BUDGET_MS`. */
  timeBudgetMs?: number
}): Promise<CollectReport> {
  const trigger = options.trigger ?? 'cron'
  const budget = Math.max(1, options.maxFetches ?? MAX_FETCHES_PER_RUN)

  if (!options.force) {
    const letzter = await lastCollectRun()
    if (letzter && Date.now() - letzter.getTime() < RUN_INTERVAL_MS) {
      return {
        ran: false,
        skipped: 'Noch nicht fällig.',
        seriesDue: 0,
        seriesFetched: 0,
        seriesFailed: 0,
        candlesAdded: 0,
        error: null,
      }
    }
  }

  const [lauf] = await db
    .insert(candleCollectRun)
    .values({ trigger })
    .returning({ id: candleCollectRun.id })

  let fetched = 0
  let failed = 0
  let added = 0
  let due = 0
  let fehler: string | null = null

  try {
    // Die aufgelösten Instrumente aller Nutzer — nur sie haben ein Symbol, das
    // beim Anbieter nachweislich existiert (Etappe 9). Ein unaufgelöstes
    // Instrument würde jeden Lauf mit demselben Fehlschlag belasten.
    const instrumente = await db
      .select({
        symbol: stock.providerSymbol,
        market: stock.market,
      })
      .from(stock)
      .where(eq(stock.resolutionStatus, 'ok'))

    // Dasselbe Papier steht womöglich in mehreren Watchlists — einmal genügt.
    const jeSymbol = new Map<string, Market>()
    for (const i of instrumente) {
      if (i.symbol) jeSymbol.set(i.symbol, i.market as Market)
    }

    const symbole = [...jeSymbol.keys()]
    if (symbole.length === 0) {
      await abschliessen(lauf.id, { due: 0, fetched: 0, failed: 0, added: 0, fehler: null })
      return {
        ran: true,
        skipped: null,
        seriesDue: 0,
        seriesFetched: 0,
        seriesFailed: 0,
        candlesAdded: 0,
        error: null,
      }
    }

    const bestand = await db
      .select({
        symbol: candleSeries.symbol,
        interval: candleSeries.interval,
        fetchedAt: candleSeries.fetchedAt,
        candleCount: candleSeries.candleCount,
      })
      .from(candleSeries)
      .where(inArray(candleSeries.symbol, symbole))

    const stand = new Map<string, { fetchedAt: Date | null; candleCount: number }>()
    for (const b of bestand) {
      stand.set(`${b.symbol}|${b.interval}`, {
        fetchedAt: b.fetchedAt,
        candleCount: b.candleCount,
      })
    }

    // Jede Kombination aus Symbol und Zeitebene ist eine Reihe.
    const faellig: { symbol: string; market: Market; interval: Interval; fetchedAt: Date | null }[] =
      []
    for (const [symbol, market] of jeSymbol) {
      for (const interval of COLLECTED_INTERVALS) {
        const s = stand.get(`${symbol}|${interval}`) ?? { fetchedAt: null, candleCount: 0 }
        if (isDueForCollection(interval, s.fetchedAt)) {
          faellig.push({ symbol, market, interval, fetchedAt: s.fetchedAt })
        }
      }
    }
    due = faellig.length

    const reihenfolge = orderByStaleness(faellig).slice(0, budget)
    const frist = Date.now() + (options.timeBudgetMs ?? TIME_BUDGET_MS)

    for (const reihe of reihenfolge) {
      // Vor jeder Reihe prüfen, nicht danach: Eine begonnene Reihe wird immer
      // fertig geschrieben, angefangen wird aber nichts mehr, wofür die Zeit
      // nicht reicht.
      if (Date.now() >= frist) break

      const vorher = stand.get(`${reihe.symbol}|${reihe.interval}`)?.candleCount ?? 0
      try {
        // Über denselben Weg wie jeder andere Abruf — der Speicher wird beim
        // Holen fortgeschrieben. Ein zweiter Schreibweg wäre eine zweite
        // Wahrheit darüber, wie Kerzen in die Datenbank kommen.
        await getStoredCandles(reihe.symbol, reihe.market, reihe.interval, { limit: 1 })
        fetched++

        const [nachher] = await db
          .select({ candleCount: candleSeries.candleCount })
          .from(candleSeries)
          .where(
            and(
              eq(candleSeries.symbol, reihe.symbol),
              eq(candleSeries.interval, reihe.interval),
            ),
          )
        added += Math.max(0, (nachher?.candleCount ?? 0) - vorher)
      } catch {
        // Der Fehlschlag steht bereits an der Reihe (`lastError`, `failCount`);
        // ein einzelnes unbekanntes Symbol darf den Lauf nicht beenden.
        failed++
      }
    }
  } catch (err) {
    fehler = err instanceof Error ? err.message : 'Unbekannter Fehler'
  }

  await abschliessen(lauf.id, { due, fetched, failed, added, fehler })

  return {
    ran: true,
    skipped: null,
    seriesDue: due,
    seriesFetched: fetched,
    seriesFailed: failed,
    candlesAdded: added,
    error: fehler,
  }
}

async function abschliessen(
  id: number,
  werte: { due: number; fetched: number; failed: number; added: number; fehler: string | null },
) {
  await db
    .update(candleCollectRun)
    .set({
      finishedAt: new Date(),
      seriesDue: werte.due,
      seriesFetched: werte.fetched,
      seriesFailed: werte.failed,
      candlesAdded: werte.added,
      error: werte.fehler,
    })
    .where(eq(candleCollectRun.id, id))
}

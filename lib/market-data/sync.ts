// Der Synchronisierungslauf — das Stück, das dafür sorgt, dass niemand mehr
// nachhaken muss.
//
// Zwei Aufgaben in einem Durchlauf:
//
//   1. AUFLÖSEN: Instrumente ohne bestätigtes Anbieter-Symbol bekommen eines
//      (`resolveSymbol`). Das kostet je Instrument mehrere Suchanfragen, läuft
//      deshalb gedrosselt und mit einer Obergrenze pro Lauf. Bereits gelöste
//      Symbole werden turnusmäßig nachgeprüft — Ticker ändern sich (Umbenennung,
//      Delisting, Fusion), und genau solche stillen Brüche sollen auffallen,
//      bevor der Nutzer sie bemerkt.
//
//   2. KURSE HOLEN: alle bestätigten Symbole in möglichst wenigen Requests und
//      ab in den dauerhaften Speicher. Die Oberfläche liest ausschließlich von
//      dort. Das ist der Unterschied zwischen „~90 Abfragen bei jedem
//      Seitenaufruf gegen ein Limit von 8 pro Minute" und „drei Abfragen alle
//      paar Minuten, egal wie viele Leute zuschauen".
//
// Der Lauf ist absichtlich fehlertolerant: ein Instrument, das sich nicht
// auflösen lässt, darf die anderen 92 nicht aufhalten. Jeder Teilfehler landet
// am Datensatz, nicht in einem Abbruch.

import { db } from '@/lib/db'
import { quoteSnapshot, stock, symbolSyncRun } from '@/lib/db/schema'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { resolveSymbol, Resolution } from './resolve'
import { getYahooQuotes, getYahooQuoteViaChart, YahooQuote } from './yahoo'
import { Market } from './types'

/** Höchstzahl Instrumente, die ein Lauf neu auflöst. Schützt vor Rate-Limits. */
const MAX_RESOLVES_PER_RUN = 25

/** Gleichzeitige Auflösungen. Bewusst klein — Yahoo mag keine Schwärme. */
const RESOLVE_CONCURRENCY = 3

/**
 * Turnus für die Nachprüfung bereits gelöster Symbole. 14 Tage ist der
 * Kompromiss: häufig genug, um eine Umbenennung zu bemerken, selten genug, um
 * das Auflösungsbudget nicht mit Bestätigungen zu verbrauchen.
 */
const REVALIDATE_AFTER_MS = 1000 * 60 * 60 * 24 * 14

/** Nach so vielen Fehlversuchen in Folge gilt ein Kurs als hängend. */
export const STALE_FAIL_THRESHOLD = 3

/**
 * Ab wann ein Kursstand als zu alt gilt und beim nächsten Seitenaufruf
 * nachgeholt wird.
 *
 * Zwei Minuten, nicht zwanzig: Ein Kurs, der eine Viertelstunde alt ist, ist
 * beim Nachziehen eines Stops oder beim Abwägen eines Einstiegs wertlos — genau
 * dort wird er aber gebraucht. Teuer ist das nicht, weil ein Lauf ALLE Symbole
 * in EINER Yahoo-Anfrage holt (siehe `fetchQuotes`): häufiger heißt hier
 * „ein Request statt keinem", nicht „neunzig statt einem".
 */
export const QUOTE_STALE_MS = 1000 * 60 * 2

export type SyncTrigger = 'cron' | 'manual' | 'onload'

export interface SyncReport {
  runId: number | null
  symbolsTotal: number
  resolvedNew: number
  stillUnresolved: number
  quotesUpdated: number
  quotesFailed: number
  /** Trades, die in diesem Lauf ein Instrument bekommen haben. */
  tradesLinked: number
  durationMs: number
  error: string | null
  /** Je Instrument, was passiert ist — für Skript-Ausgabe und Fehlersuche. */
  details: Array<{
    id: number
    ticker: string
    action: 'resolved' | 'unchanged' | 'ambiguous' | 'unresolved' | 'quote-only'
    symbol: string | null
    note: string
  }>
}

/** Läuft `tasks` mit begrenzter Gleichzeitigkeit ab. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

type StockRow = typeof stock.$inferSelect

/**
 * Welche Instrumente brauchen eine Auflösung?
 * Nie angefasste zuerst, danach die ältesten Bestätigungen. Vom Nutzer fest
 * gesetzte (`resolutionPinned`) bleiben grundsätzlich unangetastet.
 */
function needsResolution(s: StockRow, now: number): boolean {
  if (s.resolutionPinned) return false
  if (!s.providerSymbol || s.resolutionStatus !== 'ok') return true
  if (!s.resolvedAt) return true
  return now - s.resolvedAt.getTime() > REVALIDATE_AFTER_MS
}

/** Sortierschlüssel: was am dringendsten dran ist, kommt zuerst. */
function resolutionPriority(s: StockRow): number {
  if (!s.resolutionStatus) return 0 // noch nie versucht
  if (s.resolutionStatus === 'unresolved') return 1
  if (s.resolutionStatus === 'ambiguous') return 2
  return 3 // nur turnusmäßige Nachprüfung
}

/** Schreibt das Ergebnis einer Auflösung an das Instrument. */
async function persistResolution(id: number, r: Resolution): Promise<void> {
  await db
    .update(stock)
    .set({
      providerSymbol: r.symbol,
      provider: r.symbol ? 'yahoo' : null,
      resolutionStatus: r.status,
      resolutionConfidence: r.confidence,
      resolvedName: r.name,
      resolvedExchange: r.exchange,
      resolvedCurrency: r.currency,
      resolutionNote: r.note,
      resolutionCandidates: r.candidates.length ? JSON.stringify(r.candidates) : null,
      resolutionApproximate: r.approximate,
      resolvedAt: new Date(),
    })
    .where(eq(stock.id, id))
}

/**
 * Eine bestehende Auflösung darf nur dann durch eine schlechtere ersetzt
 * werden, wenn die alte nachweislich nicht mehr trägt. Sonst würde eine
 * vorübergehende Störung bei Yahoo ein funktionierendes Symbol wegwerfen.
 */
function shouldReplace(previous: StockRow, next: Resolution): boolean {
  if (next.status === 'ok') return true
  return previous.resolutionStatus !== 'ok' || !previous.providerSymbol
}

/** Speichert Kurse. Ein Symbol ohne Kurs behält seinen alten Stand. */
async function persistQuotes(
  quotes: Map<string, YahooQuote>,
  expected: string[],
): Promise<{ updated: number; failed: string[] }> {
  const failed: string[] = []
  const now = new Date()
  const rows: (typeof quoteSnapshot.$inferInsert)[] = []

  for (const symbol of expected) {
    const q = quotes.get(symbol.toUpperCase())
    if (!q) {
      failed.push(symbol)
      continue
    }
    rows.push({
      provider: 'yahoo',
      symbol: q.symbol,
      price: q.price,
      previousClose: q.previousClose,
      changePct: q.changePct,
      currency: q.currency,
      exchange: q.exchange,
      name: q.name,
      quotedAt: q.time,
      fetchedAt: now,
      lastError: null,
      failCount: 0,
    })
  }

  // EIN Upsert für alle Kurse statt einer Anweisung je Symbol.
  //
  // Vorher lief hier eine Schleife mit ~90 einzelnen Rundreisen zur Datenbank —
  // zusammen rund 19 Sekunden. Das fiel nicht auf, solange nur der Cron-Lauf
  // diesen Weg ging; seit die Selbstheilung an einem Seitenaufruf hängt, ist es
  // die Antwortzeit des Nutzers. Auf Vercel-Hobby (10 s Funktionslimit) wäre der
  // Lauf schlicht abgebrochen worden.
  if (rows.length > 0) {
    await db
      .insert(quoteSnapshot)
      .values(rows)
      .onConflictDoUpdate({
        target: [quoteSnapshot.provider, quoteSnapshot.symbol],
        // `excluded` ist die Zeile, die gerade nicht eingefügt werden konnte —
        // so gilt je Symbol sein eigener neuer Wert, nicht ein gemeinsamer.
        set: {
          price: sql`excluded."price"`,
          previousClose: sql`excluded."previousClose"`,
          changePct: sql`excluded."changePct"`,
          currency: sql`excluded."currency"`,
          exchange: sql`excluded."exchange"`,
          name: sql`excluded."name"`,
          quotedAt: sql`excluded."quotedAt"`,
          fetchedAt: sql`excluded."fetchedAt"`,
          lastError: sql`NULL`,
          failCount: sql`0`,
        },
      })
  }
  const updated = rows.length

  // Fehlschläge protokollieren, den letzten bekannten Kurs aber stehen lassen —
  // ein alter Kurs mit Zeitstempel ist ehrlicher als ein leeres Feld.
  if (failed.length > 0) {
    await db
      .update(quoteSnapshot)
      .set({
        lastError: 'Anbieter lieferte für dieses Symbol keinen Kurs.',
        failCount: sql`${quoteSnapshot.failCount} + 1`,
      })
      .where(
        and(eq(quoteSnapshot.provider, 'yahoo'), inArray(quoteSnapshot.symbol, failed)),
      )
  }

  return { updated, failed }
}

/**
 * Ein vollständiger Durchlauf.
 *
 * `onlyStockIds` beschränkt auf einzelne Instrumente (für „jetzt reparieren"
 * aus der Oberfläche); ohne Angabe läuft die gesamte Watchlist.
 */
export async function runSymbolSync(options: {
  trigger: SyncTrigger
  onlyStockIds?: number[]
  /** Auflösung erzwingen, auch wenn der Turnus noch nicht fällig ist. */
  forceResolve?: boolean
  maxResolves?: number
}): Promise<SyncReport> {
  const startedAt = Date.now()
  const details: SyncReport['details'] = []

  let runId: number | null = null
  try {
    const [run] = await db
      .insert(symbolSyncRun)
      .values({ trigger: options.trigger })
      .returning({ id: symbolSyncRun.id })
    runId = run?.id ?? null
  } catch {
    // Ohne Protokollzeile läuft die Synchronisierung trotzdem — das Protokoll
    // ist Beobachtung, keine Voraussetzung.
  }

  const report: SyncReport = {
    runId,
    symbolsTotal: 0,
    resolvedNew: 0,
    stillUnresolved: 0,
    quotesUpdated: 0,
    quotesFailed: 0,
    tradesLinked: 0,
    durationMs: 0,
    error: null,
    details,
  }

  try {
    const rows = options.onlyStockIds?.length
      ? await db.select().from(stock).where(inArray(stock.id, options.onlyStockIds))
      : await db.select().from(stock)

    report.symbolsTotal = rows.length

    // --- Schritt 1: auflösen ---------------------------------------------
    const now = Date.now()
    const pending = rows
      // `forceResolve` prüft ALLES erneut, unabhängig vom Turnus — nur von Hand
      // festgelegte Symbole bleiben auch dann unangetastet.
      .filter((s) => (options.forceResolve ? !s.resolutionPinned : needsResolution(s, now)))
      .sort((a, b) => resolutionPriority(a) - resolutionPriority(b))
      .slice(0, options.maxResolves ?? MAX_RESOLVES_PER_RUN)

    const resolvedBySymbol = new Map<number, string>()

    await mapLimit(pending, RESOLVE_CONCURRENCY, async (s) => {
      try {
        const r = await resolveSymbol({
          ticker: s.ticker,
          name: s.name,
          market: s.market as Market,
        })
        if (!shouldReplace(s, r)) {
          details.push({
            id: s.id,
            ticker: s.ticker,
            action: 'unchanged',
            symbol: s.providerSymbol,
            note: 'Bestehende Auflösung behalten — Neuversuch war nicht besser.',
          })
          return
        }
        await persistResolution(s.id, r)
        if (r.status === 'ok' && r.symbol) {
          resolvedBySymbol.set(s.id, r.symbol)
          if (s.providerSymbol !== r.symbol) report.resolvedNew++
          details.push({
            id: s.id,
            ticker: s.ticker,
            action: 'resolved',
            symbol: r.symbol,
            note: r.note,
          })
        } else {
          details.push({
            id: s.id,
            ticker: s.ticker,
            action: r.status === 'ambiguous' ? 'ambiguous' : 'unresolved',
            symbol: null,
            note: r.note,
          })
        }
      } catch (err) {
        details.push({
          id: s.id,
          ticker: s.ticker,
          action: 'unresolved',
          symbol: null,
          note: err instanceof Error ? err.message : 'Unbekannter Fehler.',
        })
      }
    })

    // --- Schritt 2: Kurse ------------------------------------------------
    // Frischer Stand nach den Auflösungen von eben.
    const current = options.onlyStockIds?.length
      ? await db.select().from(stock).where(inArray(stock.id, options.onlyStockIds))
      : await db.select().from(stock)

    const symbols = Array.from(
      new Set(
        current
          .filter((s) => s.resolutionStatus === 'ok' && s.providerSymbol)
          .map((s) => s.providerSymbol as string),
      ),
    )

    report.stillUnresolved = current.filter(
      (s) => s.resolutionStatus !== 'ok' || !s.providerSymbol,
    ).length

    if (symbols.length > 0) {
      let quotes = new Map<string, YahooQuote>()
      try {
        quotes = await getYahooQuotes(symbols)
      } catch (err) {
        report.error = err instanceof Error ? err.message : 'Kursabruf fehlgeschlagen.'
      }

      // Einzelne Lücken über den Chart-Endpunkt nachholen — der braucht keinen
      // Crumb und kommt durch, wenn die Batch-Abfrage klemmt.
      const missing = symbols.filter((s) => !quotes.has(s.toUpperCase()))
      if (missing.length > 0 && missing.length <= 15) {
        await mapLimit(missing, RESOLVE_CONCURRENCY, async (sym) => {
          try {
            const q = await getYahooQuoteViaChart(sym)
            quotes.set(sym.toUpperCase(), { ...q, symbol: sym })
          } catch {
            // bleibt eine Lücke — wird unten als Fehlschlag gezählt
          }
        })
      }

      const { updated, failed } = await persistQuotes(quotes, symbols)
      report.quotesUpdated = updated
      report.quotesFailed = failed.length

      for (const sym of failed) {
        const owner = current.find((s) => s.providerSymbol === sym)
        details.push({
          id: owner?.id ?? 0,
          ticker: owner?.ticker ?? sym,
          action: 'quote-only',
          symbol: sym,
          note: 'Kein Kurs erhalten — letzter bekannter Stand bleibt sichtbar.',
        })
      }
    }
    // --- Schritt 3: lose Trades anhängen -----------------------------------
    // Das Auffangnetz für den Fall, den weder `createTrade` noch `addStock`
    // abdecken: Der Trade wurde mit abweichendem Kürzel erfasst UND das
    // Instrument existierte damals noch nicht. Läuft erst hier, weil die
    // Zuordnung die frisch aufgelösten Anbieter-Symbole von oben braucht.
    try {
      const { linkLooseTrades } = await import('@/lib/link-trades')
      const linked = await linkLooseTrades({})
      report.tradesLinked = linked.linked
    } catch {
      // Kein Grund, den ganzen Lauf scheitern zu lassen — die Kurse stehen.
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : 'Unbekannter Fehler.'
  }

  report.durationMs = Date.now() - startedAt

  if (runId !== null) {
    try {
      await db
        .update(symbolSyncRun)
        .set({
          finishedAt: new Date(),
          symbolsTotal: report.symbolsTotal,
          quotesUpdated: report.quotesUpdated,
          resolvedNew: report.resolvedNew,
          stillUnresolved: report.stillUnresolved,
          error: report.error,
        })
        .where(eq(symbolSyncRun.id, runId))
    } catch {
      // siehe oben — Protokoll ist Beobachtung, keine Voraussetzung
    }
  }

  return report
}

/**
 * Wie alt ist der jüngste Kursstand? Grundlage für die Entscheidung, ob beim
 * Seitenaufruf ein Lauf angestoßen wird (Selbstheilung, falls der Cron hängt).
 */
/**
 * Läuft gerade schon ein Auffrischen? Dann dessen Ergebnis abwarten statt einen
 * zweiten Lauf zu starten.
 *
 * Nötig, weil mehrere Quellen dieselbe Frage stellen: die Watchlist im Takt,
 * `/api/sparklines` bei jedem Abruf und die Seiten mit Instrumentenkarten. Ohne
 * diese Klammer würden parallele Aufrufe denselben Yahoo-Batch mehrfach holen
 * und sich gegenseitig in die Upserts schreiben.
 *
 * Die Klammer gilt pro Serverprozess. Auf mehreren Instanzen kann es weiterhin
 * einen Lauf je Instanz geben — unschädlich, weil die Upserts idempotent sind.
 */
let inFlightRefresh: Promise<boolean> | null = null

/**
 * Kurse auffrischen, wenn der Speicher älter ist als `maxAgeMs`.
 *
 * Gibt zurück, ob tatsächlich geholt wurde — die Oberfläche lädt nur dann neu.
 * Bewusst NUR Kurse (`maxResolves: 0`): Ein Seitenaufruf soll schnell bleiben,
 * Neuauflösungen sind Sache des Cron-Laufs.
 *
 * Wirft nie: Ein Anbieterausfall darf die Seite nicht mitreißen — dann bleibt
 * eben der letzte bekannte Kurs mit seinem Zeitstempel stehen.
 */
export async function refreshQuotesIfStale(maxAgeMs = QUOTE_STALE_MS): Promise<boolean> {
  const age = await quotesAgeMs()
  if (age !== null && age < maxAgeMs) return false
  if (inFlightRefresh) return inFlightRefresh

  inFlightRefresh = (async () => {
    try {
      await runSymbolSync({ trigger: 'onload', maxResolves: 0 })
      return true
    } catch {
      return false
    } finally {
      inFlightRefresh = null
    }
  })()

  return inFlightRefresh
}

export async function quotesAgeMs(): Promise<number | null> {
  const [row] = await db
    .select({ newest: sql<Date | null>`max(${quoteSnapshot.fetchedAt})` })
    .from(quoteSnapshot)
  if (!row?.newest) return null
  return Date.now() - new Date(row.newest).getTime()
}

/** Instrumente, die Aufmerksamkeit brauchen — für den Hinweis in der Watchlist. */
export async function countUnresolved(userId: string): Promise<number> {
  const rows = await db
    .select({ id: stock.id })
    .from(stock)
    .where(
      and(
        eq(stock.userId, userId),
        or(
          isNull(stock.resolutionStatus),
          inArray(stock.resolutionStatus, ['ambiguous', 'unresolved']),
          isNull(stock.providerSymbol),
        ),
      ),
    )
  return rows.length
}

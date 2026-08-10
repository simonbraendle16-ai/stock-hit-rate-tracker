// Der ausführende Teil der Trade→Instrument-Verknüpfung.
//
// Die Entscheidungslogik selbst steht rein und getestet in `instrument-link.ts`;
// hier kommen nur Datenbank und Symbolauflösung dazu.
//
// Aufgerufen an drei Stellen, damit die Zuordnung dauerhaft von allein hält:
//   1. `createTrade` — beim Anlegen jedes neuen Trades.
//   2. `runSymbolSync` — als Auffangnetz für Trades, deren Instrument erst
//      SPÄTER angelegt wurde (genau der Fall, der die sechs losen Trades im
//      Bestand erzeugt hat).
//   3. Einmalig rückwirkend über `scripts/link-trades.ts`.

import { db } from '@/lib/db'
import { stock, trade } from '@/lib/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import {
  matchInstrument,
  type LinkReason,
  type LinkableInstrument,
} from './instrument-link'
import { resolveSymbol } from './market-data/resolve'
import type { Market } from './market-data/types'

export interface LinkAttempt {
  tradeId: number
  ticker: string
  stockId: number | null
  reason: LinkReason
  /** Das Anbieter-Symbol, über das zugeordnet wurde (falls verwendet). */
  viaSymbol: string | null
  /** Ticker des getroffenen Instruments — für die Kontrollausgabe. */
  instrumentTicker: string | null
}

export interface LinkReport {
  checked: number
  linked: number
  attempts: LinkAttempt[]
}

/** Instrumente eines Nutzers in der Form, die die Zuordnung braucht. */
async function loadInstruments(userId: string): Promise<LinkableInstrument[]> {
  return db
    .select({
      id: stock.id,
      ticker: stock.ticker,
      providerSymbol: stock.providerSymbol,
    })
    .from(stock)
    .where(eq(stock.userId, userId))
}

/**
 * Ordnet EINEN Ticker einem Instrument zu.
 *
 * Zuerst ohne Netz über die Tickergleichheit; nur wenn das nichts findet, wird
 * das Anbieter-Symbol aufgelöst. Das hält den Normalfall (Ticker stimmt) frei
 * von jeder externen Abfrage.
 */
export async function findInstrumentFor(
  ticker: string,
  market: Market,
  instruments: LinkableInstrument[],
): Promise<{ stockId: number | null; reason: LinkReason; viaSymbol: string | null }> {
  const direct = matchInstrument(ticker, null, instruments)
  if (direct.stockId !== null || direct.reason === 'mehrdeutig') {
    return { stockId: direct.stockId, reason: direct.reason, viaSymbol: null }
  }

  // Kein Tickertreffer → über das Anbieter-Symbol versuchen. Der Name des
  // Trades ist derselbe Text wie der Ticker; mehr wissen wir hier nicht, und
  // genau dafür verträgt der Resolver auch Klarnamen („THE TRADE DESK").
  let providerSymbol: string | null = null
  try {
    const r = await resolveSymbol({ ticker, name: ticker, market })
    if (r.status === 'ok') providerSymbol = r.symbol
  } catch {
    // Anbieter nicht erreichbar → keine Zuordnung, aber auch kein Fehler.
    // Der nächste Hintergrundlauf versucht es erneut.
    return { stockId: null, reason: 'kein-treffer', viaSymbol: null }
  }

  if (!providerSymbol) return { stockId: null, reason: 'kein-treffer', viaSymbol: null }

  const viaSymbol = matchInstrument(ticker, providerSymbol, instruments)
  return { stockId: viaSymbol.stockId, reason: viaSymbol.reason, viaSymbol: providerSymbol }
}

/** Sektion, unter der selbst angelegte Instrumente in der Watchlist landen. */
export const SEKTION_AUS_TRADES = 'Aus Trades'

/**
 * Ein Instrument für einen Trade anlegen, für den keines existiert.
 *
 * **Warum das sein muss.** Ohne Instrument hat ein Trade keine Symbolauflösung —
 * und ohne die wird der ROHTICKER an den Anbieter gereicht, was diese App
 * ausdrücklich verbietet. Genau daraus entstand die Meldung „Unbekannter Ticker
 * bei Twelve Data": Yahoo scheiterte am Rohticker, der Rückfall kannte ihn
 * ebenfalls nicht, und der Trade stand dauerhaft ohne Kurs da.
 *
 * Das neue Instrument ist bewusst als solches erkennbar (eigene Sektion) und
 * kann natürlich falsch aufgelöst sein. Aber es ist ein **sichtbarer,
 * reparierbarer** Zustand an genau einer Stelle — statt eines Trades, der still
 * für immer ohne Kurs bleibt.
 */
export async function createInstrumentForTrade(args: {
  userId: string
  ticker: string
  market: Market
}): Promise<number> {
  const [row] = await db
    .insert(stock)
    .values({
      userId: args.userId,
      // Mehr als den Ticker weiß ein Trade nicht. Die Auflösung trägt gleich
      // den echten Namen nach (`resolvedName`).
      name: args.ticker,
      ticker: args.ticker,
      market: args.market,
      watchlistSection: SEKTION_AUS_TRADES,
    })
    .returning({ id: stock.id })
  return row.id
}

/**
 * Verknüpft alle Trades ohne `stockId`.
 *
 * `dryRun` schreibt nichts und liefert nur, was passieren würde — damit sich das
 * Ergebnis kontrollieren lässt, bevor Zuordnungen in echten Trades landen.
 * Bestehende Zuordnungen werden NIE angefasst (`stockId IS NULL` im Filter).
 *
 * `anlegen` schließt die letzte Lücke: Findet sich kein Instrument, wird eins
 * erzeugt. Nur damit gilt „jeder Trade ist aufgelöst" wirklich. Bei
 * `mehrdeutig` wird NICHT angelegt — dort gibt es Kandidaten, und ein neues
 * Instrument daneben würde die Verwirrung verdoppeln statt sie aufzulösen.
 */
export async function linkLooseTrades(options: {
  userId?: string
  dryRun?: boolean
  anlegen?: boolean
} = {}): Promise<LinkReport> {
  const rows = await db
    .select({
      id: trade.id,
      userId: trade.userId,
      ticker: trade.ticker,
      market: trade.market,
    })
    .from(trade)
    .where(
      options.userId
        ? and(eq(trade.userId, options.userId), isNull(trade.stockId))
        : isNull(trade.stockId),
    )

  const report: LinkReport = { checked: rows.length, linked: 0, attempts: [] }
  if (rows.length === 0) return report

  // Instrumente je Nutzer einmal laden statt je Trade.
  const cache = new Map<string, LinkableInstrument[]>()
  const byId = new Map<number, string>()

  for (const row of rows) {
    let instruments = cache.get(row.userId)
    if (!instruments) {
      instruments = await loadInstruments(row.userId)
      cache.set(row.userId, instruments)
      for (const i of instruments) byId.set(i.id, i.ticker)
    }

    const res = await findInstrumentFor(row.ticker, row.market as Market, instruments)

    let stockId = res.stockId
    let reason = res.reason
    let angelegt = false

    // Letzte Stufe: nichts gefunden UND nicht mehrdeutig → Instrument anlegen.
    if (stockId === null && reason === 'kein-treffer' && options.anlegen) {
      angelegt = true
      reason = 'angelegt'
      if (!options.dryRun) {
        stockId = await createInstrumentForTrade({
          userId: row.userId,
          ticker: row.ticker,
          market: row.market as Market,
        })
        // Der Zwischenspeicher muss mitwachsen, sonst legt ein zweiter Trade
        // auf denselben Ticker ein zweites Instrument an.
        instruments.push({ id: stockId, ticker: row.ticker, providerSymbol: null })
        byId.set(stockId, row.ticker)
      }
    }

    report.attempts.push({
      tradeId: row.id,
      ticker: row.ticker,
      stockId,
      reason,
      viaSymbol: res.viaSymbol,
      instrumentTicker: angelegt ? row.ticker : stockId ? (byId.get(stockId) ?? null) : null,
    })

    if (stockId !== null && !options.dryRun) {
      await db
        .update(trade)
        .set({ stockId })
        .where(and(eq(trade.id, row.id), isNull(trade.stockId)))
      report.linked++
    } else if (stockId !== null || angelegt) {
      report.linked++
    }
  }

  return report
}

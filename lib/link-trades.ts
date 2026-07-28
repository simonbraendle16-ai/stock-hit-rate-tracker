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

/**
 * Verknüpft alle Trades ohne `stockId`.
 *
 * `dryRun` schreibt nichts und liefert nur, was passieren würde — damit sich das
 * Ergebnis kontrollieren lässt, bevor Zuordnungen in echten Trades landen.
 * Bestehende Zuordnungen werden NIE angefasst (`stockId IS NULL` im Filter).
 */
export async function linkLooseTrades(options: {
  userId?: string
  dryRun?: boolean
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
    report.attempts.push({
      tradeId: row.id,
      ticker: row.ticker,
      stockId: res.stockId,
      reason: res.reason,
      viaSymbol: res.viaSymbol,
      instrumentTicker: res.stockId ? (byId.get(res.stockId) ?? null) : null,
    })

    if (res.stockId !== null && !options.dryRun) {
      await db
        .update(trade)
        .set({ stockId: res.stockId })
        .where(and(eq(trade.id, row.id), isNull(trade.stockId)))
      report.linked++
    } else if (res.stockId !== null) {
      report.linked++
    }
  }

  return report
}

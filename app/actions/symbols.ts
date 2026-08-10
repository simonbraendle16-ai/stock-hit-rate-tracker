'use server'

// Serveraktionen rund um die Symbolauflösung: Kurse für die Watchlist lesen,
// einzelne Instrumente reparieren, nach Symbolen suchen.
//
// Alles Lesende geht über den Kursspeicher (`quote_snapshot`), NIE direkt zum
// Anbieter. Genau das war der alte Fehler: Beim Öffnen der Watchlist liefen ~90
// Einzelabfragen los, von denen die meisten im Rate-Limit endeten. Jetzt füllt
// der Hintergrundlauf den Speicher gebündelt, und die Seite liest nur noch.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { quoteSnapshot, stock } from '@/lib/db/schema'
import type { ResolutionCandidate } from '@/lib/market-data/resolve'
import { resolveSymbol } from '@/lib/market-data/resolve'
import { runSymbolSync, refreshQuotesIfStale } from '@/lib/market-data/sync'
import { searchYahoo } from '@/lib/market-data/yahoo'
import { toUserTicker } from '@/lib/market-data/symbol-aliases'
import { QUOTE_TYPE_MARKET } from '@/lib/market-data/types'
import type { Market, WatchlistQuote } from '@/lib/market-data/types'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/**
 * Kurse aller Instrumente des angemeldeten Nutzers — ein einziger Datenbank-
 * Zugriff, kein Anbieterkontakt.
 */
export async function getWatchlistQuotes(): Promise<WatchlistQuote[]> {
  const userId = await getUserId()

  const rows = await db
    .select({
      stockId: stock.id,
      status: stock.resolutionStatus,
      providerSymbol: stock.providerSymbol,
      resolvedName: stock.resolvedName,
      resolvedExchange: stock.resolvedExchange,
      resolutionNote: stock.resolutionNote,
      approximate: stock.resolutionApproximate,
      pinned: stock.resolutionPinned,
      price: quoteSnapshot.price,
      changePct: quoteSnapshot.changePct,
      currency: quoteSnapshot.currency,
      quotedAt: quoteSnapshot.quotedAt,
      fetchedAt: quoteSnapshot.fetchedAt,
      failCount: quoteSnapshot.failCount,
    })
    .from(stock)
    .leftJoin(quoteSnapshot, eq(quoteSnapshot.symbol, stock.providerSymbol))
    .where(eq(stock.userId, userId))

  return rows.map((r) => ({
    ...r,
    approximate: !!r.approximate,
    pinned: !!r.pinned,
    failCount: r.failCount ?? 0,
    fetchedAt: r.fetchedAt ? new Date(r.fetchedAt).toISOString() : null,
  }))
}

/**
 * Selbstheilung, während eine Seite offen ist.
 *
 * Der Cron-Job ist der Regelweg — aber auf dem Vercel-Hobby-Plan darf er nur
 * einmal am Tag laufen, und ein Zeitplan kann grundsätzlich hängen. Deshalb
 * fragt die Oberfläche im Takt nach (`components/quote-auto-refresh.tsx`) und
 * holt bei zu altem Stand selbst nach.
 *
 * Die Schwelle in `refreshQuotesIfStale` verhindert, dass daraus ein Abruf pro
 * Nachfrage wird; die Klammer dort verhindert parallele Läufe.
 *
 * Gibt `true` zurück, wenn wirklich geholt wurde — nur dann lohnt sich auf der
 * Seite ein Neuladen.
 */
export async function refreshQuotes(maxAgeMs?: number): Promise<boolean> {
  await getUserId()
  const refreshed = await refreshQuotesIfStale(maxAgeMs)
  if (refreshed) {
    // Die vier Orte, an denen Kurse stehen — sonst zeigt die Seite nach dem
    // Lauf weiter den alten Stand aus dem Server-Cache.
    revalidatePath('/watchlist')
    revalidatePath('/analysis')
    revalidatePath('/tracking')
  }
  return refreshed
}

/** Erzwungener Lauf über alles — hinter dem Knopf „Jetzt synchronisieren". */
export async function syncAllSymbols(): Promise<{
  resolvedNew: number
  stillUnresolved: number
  quotesUpdated: number
  quotesFailed: number
  error: string | null
}> {
  await getUserId()
  const report = await runSymbolSync({ trigger: 'manual' })
  revalidatePath('/watchlist')
  return {
    resolvedNew: report.resolvedNew,
    stillUnresolved: report.stillUnresolved,
    quotesUpdated: report.quotesUpdated,
    quotesFailed: report.quotesFailed,
    error: report.error,
  }
}

/** Ein einzelnes Instrument neu auflösen — der Knopf „Erneut versuchen". */
export async function reresolveStock(stockId: number): Promise<{
  status: string
  symbol: string | null
  note: string
  candidates: ResolutionCandidate[]
}> {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(stock)
    .where(and(eq(stock.id, stockId), eq(stock.userId, userId)))
  if (!row) throw new Error('Instrument nicht gefunden.')

  const r = await resolveSymbol({
    ticker: row.ticker,
    name: row.name,
    market: row.market as Market,
  })

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
      // Ein ausdrücklicher Neuversuch hebt eine frühere Handauswahl auf.
      resolutionPinned: false,
      resolvedAt: new Date(),
    })
    .where(eq(stock.id, stockId))

  if (r.symbol) await runSymbolSync({ trigger: 'manual', onlyStockIds: [stockId], maxResolves: 0 })
  revalidatePath('/watchlist')

  return { status: r.status, symbol: r.symbol, note: r.note, candidates: r.candidates }
}

/**
 * Ein Symbol von Hand festlegen.
 *
 * Setzt `resolutionPinned` — ab dann fasst die Automatik dieses Instrument nicht
 * mehr an. Eine bewusste Entscheidung des Nutzers darf nicht beim nächsten
 * Hintergrundlauf stillschweigend überschrieben werden.
 */
export async function pinStockSymbol(
  stockId: number,
  symbol: string,
): Promise<{ price: number | null; name: string | null }> {
  const userId = await getUserId()
  const [row] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.id, stockId), eq(stock.userId, userId)))
  if (!row) throw new Error('Instrument nicht gefunden.')

  const clean = symbol.trim().toUpperCase()
  if (!clean || clean.length > 24) throw new Error('Ungültiges Symbol.')

  // Auch eine Handauswahl wird geprüft — ein Symbol ohne Kurs hilft niemandem.
  const { getYahooQuotes } = await import('@/lib/market-data/yahoo')
  const quotes = await getYahooQuotes([clean])
  const q = quotes.get(clean)
  if (!q || !(q.price > 0)) {
    throw new Error(`„${clean}“ liefert bei Yahoo keinen Kurs. Bitte ein anderes Symbol wählen.`)
  }

  await db
    .update(stock)
    .set({
      providerSymbol: q.symbol,
      provider: 'yahoo',
      resolutionStatus: 'ok',
      resolutionConfidence: 100,
      resolvedName: q.name,
      resolvedExchange: q.exchange,
      resolvedCurrency: q.currency,
      resolutionNote: 'Von Hand festgelegt.',
      resolutionApproximate: false,
      resolutionPinned: true,
      resolvedAt: new Date(),
    })
    .where(eq(stock.id, stockId))

  await runSymbolSync({ trigger: 'manual', onlyStockIds: [stockId], maxResolves: 0 })
  revalidatePath('/watchlist')

  return { price: q.price, name: q.name }
}

/**
 * Ein Instrument direkt aus einem Suchtreffer anlegen.
 *
 * Der Weg über die Suche ersetzt das Tippen von Name, Ticker und Markt. Zwei
 * Dinge macht er dabei bewusst anders als das Formular:
 *
 * - **Rückübersetzung.** Yahoo liefert `CL=F`, in der Watchlist steht `CL1!`.
 *   `toUserTicker` führt das zusammen, sonst stünde dasselbe Öl je nach
 *   Eingabeweg unter zwei Kürzeln in derselben Liste.
 * - **Festschreiben.** Das Anbieter-Symbol ist durch die Suche bereits bekannt.
 *   Es wird gepinnt, statt die Automatik dieselbe Frage nochmal raten zu
 *   lassen — das war die Quelle der falschen Auflösungen.
 *
 * Schlägt das Festschreiben fehl (kein Kurs bei Yahoo), bleibt das Instrument
 * trotzdem bestehen: Der Klick des Nutzers geht nie verloren, der reguläre
 * Auflösungslauf übernimmt, und die Watchlist weist den Zustand ohnehin aus.
 */
export async function addStockFromSearch(hit: {
  symbol: string
  name: string
  quoteType: string
}): Promise<{ id: number; ticker: string; bereitsVorhanden: boolean; hinweis: string | null }> {
  const userId = await getUserId()

  const providerSymbol = hit.symbol.trim().toUpperCase()
  if (!providerSymbol) throw new Error('Kein Symbol im Suchtreffer.')

  const ticker = toUserTicker(providerSymbol)
  const markt = QUOTE_TYPE_MARKET[hit.quoteType?.toUpperCase() ?? ''] ?? 'sonstiges'

  // Doppelte abfangen — sonst steht dasselbe Instrument nach zwei Klicks zweimal
  // in der Liste, mit getrennten Prognosen und Trades.
  const [vorhanden] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.userId, userId), eq(stock.ticker, ticker)))
    .limit(1)
  if (vorhanden) {
    return { id: vorhanden.id, ticker, bereitsVorhanden: true, hinweis: null }
  }

  const { addStock } = await import('./stocks')
  const { id } = await addStock({
    name: hit.name?.trim() || ticker,
    ticker,
    market: markt,
  })

  let hinweis: string | null = null
  try {
    await pinStockSymbol(id, providerSymbol)
  } catch (err) {
    hinweis = err instanceof Error ? err.message : 'Symbol konnte nicht festgeschrieben werden.'
  }

  revalidatePath('/watchlist')
  return { id, ticker, bereitsVorhanden: false, hinweis }
}

/** Freie Symbolsuche für die Handauswahl im Reparatur-Dialog. */
export async function searchSymbols(query: string): Promise<
  Array<{ symbol: string; name: string; exchange: string; quoteType: string }>
> {
  await getUserId()
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const hits = await searchYahoo(q, 10)
    return hits.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      exchange: h.exchangeName || h.exchange,
      quoteType: h.quoteType,
    }))
  } catch {
    return []
  }
}

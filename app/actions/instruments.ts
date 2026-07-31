'use server'

// Lädt die Instrumentenkarten: Prognosen, Trades und den letzten bekannten Kurs.
//
// Bewusst EIN Ladeweg für alle vier Einsatzorte (Analyse, Auswertung,
// Instrument-Detail, Watchlist). Vier eigene Abfragen wären vier Gelegenheiten,
// dieselbe Kennzahl unterschiedlich zu rechnen.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { assessment, quoteSnapshot, stock, trade, tradeEvent } from '@/lib/db/schema'
import { computeInstrumentStats, overallGap } from '@/lib/instrument-stats'
import type { InstrumentStats } from '@/lib/instrument-stats'
import type { TradeEventsByTrade } from '@/lib/trade-stats'
import type { TradeEventRow } from '@/lib/trade-events'
import { asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { loadScopeContext, tradeScopeWhere } from '@/lib/portfolio-context'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/**
 * Eine Karte je Instrument mit Aktivität, plus die Gesamtlücke.
 *
 * Die Kurse kommen aus dem Kursspeicher (Etappe 9) — kein Anbieterkontakt beim
 * Seitenaufbau.
 */
export async function getInstrumentCards(): Promise<{
  cards: InstrumentStats[]
  quotes: Record<number, { price: number; changePct: number | null; currency: string | null }>
  overall: ReturnType<typeof overallGap>
}> {
  const userId = await getUserId()
  const { portfolioIds: scopePortfolioIds } = await loadScopeContext(userId)

  const [instruments, assessments, trades, events, quotes] = await Promise.all([
    db
      .select({
        id: stock.id,
        ticker: stock.ticker,
        name: stock.name,
        market: stock.market,
      })
      .from(stock)
      .where(eq(stock.userId, userId)),
    db
      .select({
        stockId: assessment.stockId,
        isCorrect: assessment.isCorrect,
        zoneNotReached: assessment.zoneNotReached,
      })
      .from(assessment)
      .where(eq(assessment.userId, userId)),
    // Nur die Trades der aktiven Auswahl (Etappe 12). Die Karte trennt Echtgeld
    // und Demo ohnehin in zwei Zeilen — aber ein Trade aus einem Depot, das
    // gerade nicht angeschaut wird, gehört auch in keine der beiden. Die
    // PROGNOSEN darüber bleiben kontoweit: in ihnen steckt kein Geld, sie hängen
    // an keinem Depot.
    db.select().from(trade).where(tradeScopeWhere(userId, scopePortfolioIds)),
    db
      .select()
      .from(tradeEvent)
      .where(eq(tradeEvent.userId, userId))
      // Chronologisch — `settlePosition` rechnet die Ereignisse der Reihe nach ab.
      .orderBy(asc(tradeEvent.at), asc(tradeEvent.id)),
    db
      .select({
        stockId: stock.id,
        price: quoteSnapshot.price,
        changePct: quoteSnapshot.changePct,
        currency: quoteSnapshot.currency,
      })
      .from(stock)
      .innerJoin(quoteSnapshot, eq(quoteSnapshot.symbol, stock.providerSymbol))
      .where(eq(stock.userId, userId)),
  ])

  // Events je Trade — dieselbe Form, die alle event-aware Auswertungen erwarten.
  const eventsByTrade: TradeEventsByTrade = new Map()
  for (const e of events as TradeEventRow[]) {
    const list = eventsByTrade.get(e.tradeId)
    if (list) list.push(e)
    else eventsByTrade.set(e.tradeId, [e])
  }

  const cards = computeInstrumentStats(instruments, assessments, trades, eventsByTrade)

  const quoteMap: Record<
    number,
    { price: number; changePct: number | null; currency: string | null }
  > = {}
  for (const q of quotes) {
    quoteMap[q.stockId] = { price: q.price, changePct: q.changePct, currency: q.currency }
  }

  return { cards, quotes: quoteMap, overall: overallGap(cards) }
}

/** Nur die Karte eines einzelnen Instruments — für `/stock/[id]`. */
export async function getInstrumentCard(stockId: number): Promise<{
  card: InstrumentStats | null
  quote: { price: number; changePct: number | null; currency: string | null } | null
}> {
  const { cards, quotes } = await getInstrumentCards()
  const card = cards.find((c) => c.stockId === stockId) ?? null
  return { card, quote: quotes[stockId] ?? null }
}

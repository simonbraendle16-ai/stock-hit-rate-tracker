import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { stock, trade } from '@/lib/db/schema'

/** Current demand, never inferred from waves, plans or past trades. */
export async function activeTradeInstruments() {
  return db.selectDistinct({ id: stock.id, symbol: stock.providerSymbol,
    market: stock.market, provider: stock.provider }).from(stock)
    .innerJoin(trade, and(eq(trade.stockId, stock.id), eq(trade.userId, stock.userId)))
    .where(and(eq(trade.status, 'aktiv'), eq(stock.resolutionStatus, 'ok')))
}

/** Scalar, bounded recheck rather than transferring the entire demand for every row. */
export async function hasActiveTradeDemand(symbol: string, provider: string) {
  const rows = await db.select({ id: stock.id }).from(stock)
    .innerJoin(trade, and(eq(trade.stockId, stock.id), eq(trade.userId, stock.userId)))
    .where(and(eq(trade.status, 'aktiv'), eq(stock.resolutionStatus, 'ok'),
      eq(stock.providerSymbol, symbol), sql`coalesce(${stock.provider},'yahoo')=${provider}`)).limit(1)
  return rows.length > 0
}

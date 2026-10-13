import { eq } from 'drizzle-orm'
import { db } from './db'
import { stock } from './db/schema'

/** Alerts may only use an identified instrument, never the raw ticker fallback. */
export async function createAlertSymbolResolver(userId: string) {
  const rows = await db.select({ id: stock.id, ticker: stock.ticker, symbol: stock.providerSymbol,
    status: stock.resolutionStatus, approximate: stock.resolutionApproximate, market: stock.market }).from(stock).where(eq(stock.userId, userId))
  return (ticker: string, stockId: number | null, market: string): string | null => {
    const matches = rows.filter(r => stockId != null ? r.id === stockId : r.ticker.trim().toUpperCase() === ticker.trim().toUpperCase())
    if (matches.length !== 1) return null
    const r = matches[0]
    return r.status === 'ok' && r.symbol && !r.approximate && r.market === market ? r.symbol : null
  }
}

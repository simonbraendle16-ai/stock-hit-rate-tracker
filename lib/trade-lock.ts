import { and, eq } from 'drizzle-orm'
import { db, inDatabaseTransaction } from '@/lib/db'
import { portfolio, trade } from '@/lib/db/schema'

/** Portfolio first: concurrent entries also see the latest available margin. */
export async function withTradeLock<T>(
  userId: string,
  tradeId: number,
  callback: (row: typeof trade.$inferSelect, depot: typeof portfolio.$inferSelect) => Promise<T>,
): Promise<T> {
  return inDatabaseTransaction(async () => {
    const owned = and(eq(trade.id, tradeId), eq(trade.userId, userId))
    const [before] = await db.select({ portfolioId: trade.portfolioId }).from(trade).where(owned)
    if (!before) throw new Error('Diesen Trade gibt es nicht.')
    const [depot] = await db.select().from(portfolio)
      .where(and(eq(portfolio.id, before.portfolioId), eq(portfolio.userId, userId))).for('update')
    if (!depot) throw new Error('Dieses Depot gibt es nicht.')
    const [row] = await db.select().from(trade).where(owned).for('update')
    if (!row || row.portfolioId !== depot.id) {
      throw new Error('Der Trade wurde inzwischen geändert. Bitte erneut versuchen.')
    }
    return callback(row, depot)
  })
}

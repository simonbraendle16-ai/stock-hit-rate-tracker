import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { trade, tradeEvent } from './db/schema'
import { settlePosition } from './trade-events'
import { orderedEvents, validateEventSequence } from './trade-history'
import { reviewStatusAfterClose } from './trade-review-state'

/** Call under the shared portfolio/trade transaction lock. Never synthesize an original plan. */
export async function projectPosition(userId: string, id: number) {
  const owned = and(eq(trade.id, id), eq(trade.userId, userId))
  const [t] = await db.select().from(trade).where(owned)
  if (!t) throw new Error('Trade nicht gefunden.')
  const events = orderedEvents(await db.select().from(tradeEvent).where(and(eq(tradeEvent.tradeId, id), eq(tradeEvent.userId, userId))))
  validateEventSequence(events)
  const opening = events.find(e => e.type === 'eroeffnet')
  if (!opening) throw new Error('Dokumentierte Eröffnung fehlt.')
  const closing = events.find(e => e.type === 'geschlossen')
  const settled = settlePosition(t, events)
  const result = closing && settled.moneyComplete && Number.isFinite(settled.totalNet)
    ? Math.abs(settled.totalNet) < 1e-8 ? 'breakeven' : settled.totalNet > 0 ? 'gewinn' : 'verlust' : null
  const [saved] = await db.update(trade).set({
    openedAt: opening.at, entryPrice: settled.avgEntry, positionSize: settled.totalEntered,
    ...(closing ? { status: 'abgeschlossen', closedAt: closing.at, actualExitPrice: closing.price, result,
      reviewStatus: reviewStatusAfterClose(t, result, t.status !== 'abgeschlossen') } : {}),
  }).where(owned).returning()
  return saved
}

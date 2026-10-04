import { db } from '@/lib/db'
import { brokerOrder, trade } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const id = positiveId((await context.params).id)
    const raw = await readJsonObject(req)
    onlyKeys(raw, ['tradeId', 'confirmedByUser', 'capturedAt', 'replacesBrokerOrderId'])
    const tradeId = positiveId(String(raw.tradeId ?? ''))
    const replacesBrokerOrderId = raw.replacesBrokerOrderId == null ? null
      : positiveId(String(raw.replacesBrokerOrderId))
    if (replacesBrokerOrderId === id) throw new ApiError(422, 'Ersatzbeleg muss eine andere Order sein.')
    if (raw.confirmedByUser !== true || typeof raw.capturedAt !== 'string' ||
        !Number.isFinite(Date.parse(raw.capturedAt))) {
      throw new ApiError(422, 'Bestätigter Trade-Bezug mit Zeitpunkt erforderlich.')
    }
    const result = await db.transaction(async (tx) => {
      const [ownedOrder] = await tx.select({ portfolioId: brokerOrder.portfolioId }).from(brokerOrder)
        .where(and(eq(brokerOrder.id, id), eq(brokerOrder.userId, userId))).limit(1)
      if (!ownedOrder) throw new ApiError(404, 'Brokerbeleg nicht gefunden.')
      await tx.execute(sql`SELECT id FROM portfolio WHERE id = ${ownedOrder.portfolioId}
        AND "userId" = ${userId} FOR UPDATE`)
      await tx.execute(sql`SELECT id FROM broker_order WHERE "userId" = ${userId}
        AND id IN (${id}, ${replacesBrokerOrderId ?? id}) ORDER BY id FOR UPDATE`)
      const [order] = await tx.select().from(brokerOrder).where(and(eq(brokerOrder.id, id),
        eq(brokerOrder.userId, userId))).limit(1)
      if (!order) throw new ApiError(404, 'Brokerbeleg nicht gefunden.')
      if (order.linkedTradeId === tradeId) return order
      if (order.linkedTradeId != null) throw new ApiError(409, 'Brokerbeleg ist bereits anders verknüpft.')
      const [plan] = await tx.select().from(trade).where(and(eq(trade.id, tradeId),
        eq(trade.userId, userId), eq(trade.portfolioId, order.portfolioId), eq(trade.status, 'geplant'))).limit(1)
      if (!plan) throw new ApiError(409, 'Passender geplanter Trade fehlt.')
      let referencePrice = order.state === 'filled' ? order.executionPrice : order.limitPrice
      if (replacesBrokerOrderId != null) {
        const [previous] = await tx.select().from(brokerOrder).where(and(
          eq(brokerOrder.id, replacesBrokerOrderId), eq(brokerOrder.userId, userId))).limit(1)
        if (!previous || previous.linkedTradeId !== tradeId || previous.state !== 'accepted' ||
            order.state !== 'filled' || !order.brokerPositionId ||
            previous.portfolioId !== order.portfolioId ||
            previous.brokerAccountId !== order.brokerAccountId ||
            previous.broker !== order.broker ||
            previous.ticker.replace(/^#/, '').toUpperCase() !== order.ticker.replace(/^#/, '').toUpperCase() ||
            previous.direction !== order.direction || previous.quantity == null || order.quantity == null ||
            Math.abs(previous.quantity - order.quantity) > Math.max(1e-8, previous.quantity * 1e-6)) {
          throw new ApiError(409, 'Ausstehende Order und Fill sind nicht eindeutig vereinbar.')
        }
        referencePrice = previous.limitPrice
      }
      if (plan.ticker.replace(/^#/, '').toUpperCase() !== order.ticker.replace(/^#/, '').toUpperCase() ||
          plan.direction !== order.direction || referencePrice == null ||
          Math.abs(plan.entryPrice - referencePrice) > Math.max(1, referencePrice) * 0.000001) {
        throw new ApiError(409, 'Instrument, Richtung oder Einstieg widersprechen dem Brokerbeleg.')
      }
      if (replacesBrokerOrderId != null) {
        await tx.update(brokerOrder).set({ linkedTradeId: null, updatedAt: new Date() })
          .where(and(eq(brokerOrder.id, replacesBrokerOrderId), eq(brokerOrder.userId, userId)))
      }
      const [linked] = await tx.update(brokerOrder).set({ linkedTradeId: tradeId, updatedAt: new Date() })
        .where(and(eq(brokerOrder.id, id), eq(brokerOrder.userId, userId), isNull(brokerOrder.linkedTradeId)))
        .returning()
      if (!linked) throw new ApiError(409, 'Brokerbeleg wurde gleichzeitig verknüpft.')
      return linked
    })
    return NextResponse.json(result)
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
      return apiResponseError(new ApiError(409, 'Dieser Trade ist bereits mit einem anderen Brokerbeleg verknüpft.'))
    }
    return apiResponseError(cause)
  }
}

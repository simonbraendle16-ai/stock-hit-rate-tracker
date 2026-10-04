import { db } from '@/lib/db'
import { brokerOrder, portfolio, trade } from '@/lib/db/schema'
import { ApiError, apiResponseError, positiveId, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { matchingPlannedTradeId, normalizeBrokerOrder } from '@/lib/assistant-broker-order'
import { and, desc, eq, lt } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:read')
    const params = req.nextUrl.searchParams
    if ([...params.keys()].some((key) => !['portfolioId', 'limit', 'beforeId'].includes(key))) {
      throw new ApiError(400, 'Unbekannter Filter.')
    }
    const portfolioId = params.get('portfolioId') ? positiveId(params.get('portfolioId')!) : null
    const beforeId = params.get('beforeId') ? positiveId(params.get('beforeId')!) : null
    const limitRaw = params.get('limit') ?? '50'
    if (!/^[1-9]\d*$/.test(limitRaw) || Number(limitRaw) > 100) {
      throw new ApiError(400, 'limit muss zwischen 1 und 100 liegen.')
    }
    if (portfolioId != null) await assertDemoPortfolio(userId, portfolioId)
    const limit = Number(limitRaw)
    const rows = await db.select().from(brokerOrder).where(and(
      eq(brokerOrder.userId, userId),
      portfolioId == null ? undefined : eq(brokerOrder.portfolioId, portfolioId),
      beforeId == null ? undefined : lt(brokerOrder.id, beforeId),
    )).orderBy(desc(brokerOrder.id)).limit(limit + 1)
    const page = rows.slice(0, limit)
    return NextResponse.json({ items: page, nextBeforeId: rows.length > limit ? page.at(-1)?.id : null })
  } catch (cause) { return apiResponseError(cause) }
}

async function assertDemoPortfolio(userId: string, portfolioId: number) {
  const [row] = await db.select({ id: portfolio.id }).from(portfolio).where(and(
    eq(portfolio.id, portfolioId), eq(portfolio.userId, userId),
    eq(portfolio.kind, 'demo'),
  )).limit(1)
  if (!row) throw new ApiError(404, 'Demo-Depot nicht gefunden.')
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const raw = await readJsonObject(req)
    const input = normalizeBrokerOrder(raw)
    await assertDemoPortfolio(userId, input.portfolioId)
    const configuredAccount = process.env.AVATRADE_DEMO_ACCOUNT_ID
    if (!configuredAccount) throw new ApiError(503, 'Demo-Brokerkonto ist noch nicht konfiguriert.')
    if (input.brokerAccountId !== configuredAccount) throw new ApiError(403, 'Brokerkonto nicht freigegeben.')

    const identity = and(eq(brokerOrder.userId, userId), eq(brokerOrder.broker, 'avatrade'),
      eq(brokerOrder.brokerAccountId, input.brokerAccountId),
      eq(brokerOrder.brokerOrderId, input.brokerOrderId))
    const [existing] = await db.select().from(brokerOrder).where(identity).limit(1)
    if (existing) {
      if (existing.portfolioId !== input.portfolioId || existing.ticker !== input.ticker ||
          existing.direction !== input.direction ||
          (existing.orderType !== input.orderType && !(input.state === 'filled' && input.orderType === 'other'))) {
        throw new ApiError(409, 'Broker-Order-ID widerspricht dem gespeicherten Auftrag.')
      }
      if ((existing.state === 'cancelled' && input.state === 'filled') ||
          (existing.state === 'filled' && input.state === 'cancelled')) {
        throw new ApiError(409, 'Widersprüchlicher Brokerstatus.')
      }
      if (input.observedAt <= existing.observedAt) return NextResponse.json(existing)
      const state = existing.state === 'filled' || existing.state === 'cancelled' ? existing.state : input.state
      const [updated] = await db.update(brokerOrder).set({
        state,
        brokerPositionId: input.brokerPositionId ?? existing.brokerPositionId,
        limitPrice: input.limitPrice ?? existing.limitPrice,
        executionPrice: input.executionPrice ?? existing.executionPrice,
        quantity: input.quantity ?? existing.quantity,
        stopLoss: input.state === 'accepted' && Object.hasOwn(raw, 'stopLoss')
          ? input.stopLoss : (input.stopLoss ?? existing.stopLoss),
        takeProfit: input.state === 'accepted' && Object.hasOwn(raw, 'takeProfit')
          ? input.takeProfit : (input.takeProfit ?? existing.takeProfit),
        placedAt: input.placedAt ?? existing.placedAt,
        filledAt: input.filledAt ?? existing.filledAt,
        observedAt: input.observedAt,
        updatedAt: new Date(),
      }).where(and(identity, eq(brokerOrder.id, existing.id), eq(brokerOrder.observedAt, existing.observedAt))).returning()
      if (!updated) throw new ApiError(409, 'Brokerauftrag wurde gleichzeitig geändert; bitte erneut senden.')
      return NextResponse.json(updated)
    }

    let linkedTradeId: number | null = null
    if (input.limitPrice != null) {
      const plans = await db.select({ id: trade.id, ticker: trade.ticker,
        direction: trade.direction, entryPrice: trade.entryPrice }).from(trade).where(and(
        eq(trade.userId, userId), eq(trade.portfolioId, input.portfolioId), eq(trade.status, 'geplant'),
      ))
      linkedTradeId = matchingPlannedTradeId(input, plans)
      if (linkedTradeId != null) {
        const [alreadyLinked] = await db.select({ id: brokerOrder.id }).from(brokerOrder)
          .where(and(eq(brokerOrder.userId, userId), eq(brokerOrder.linkedTradeId, linkedTradeId))).limit(1)
        if (alreadyLinked) linkedTradeId = null
      }
    }
    const insert = async (planId: number | null) => db.insert(brokerOrder)
      .values({ ...input, userId, linkedTradeId: planId })
      .onConflictDoNothing({ target: [brokerOrder.userId, brokerOrder.broker,
        brokerOrder.brokerAccountId, brokerOrder.brokerOrderId] }).returning()
    let created: typeof brokerOrder.$inferSelect | undefined
    try {
      ;[created] = await insert(linkedTradeId)
    } catch (cause) {
      // Zwei verschiedene Brokeraufträge können gleichzeitig denselben Plan finden.
      // Der zweite Auftrag bleibt erhalten, aber ohne unsichere Verknüpfung.
      if (linkedTradeId == null || !cause || typeof cause !== 'object' ||
          !('code' in cause) || cause.code !== '23505') throw cause
      ;[created] = await insert(null)
    }
    if (created) return NextResponse.json(created, { status: 201 })
    const [concurrent] = await db.select().from(brokerOrder).where(identity).limit(1)
    if (concurrent) {
      if (concurrent.portfolioId !== input.portfolioId || concurrent.ticker !== input.ticker ||
          concurrent.direction !== input.direction ||
          (concurrent.orderType !== input.orderType && !(input.state === 'filled' && input.orderType === 'other'))) {
        throw new ApiError(409, 'Broker-Order-ID widerspricht dem gespeicherten Auftrag.')
      }
      return NextResponse.json(concurrent)
    }
    throw new ApiError(503, 'Brokerauftrag konnte nicht zurückgelesen werden.')
  } catch (cause) { return apiResponseError(cause) }
}

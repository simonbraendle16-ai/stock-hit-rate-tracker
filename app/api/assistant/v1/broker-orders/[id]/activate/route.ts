import { db } from '@/lib/db'
import { brokerExit, brokerOrder, trade, tradeEvent } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { normalizeMoodCheck, serializeMoodTags, type MoodCheckInput } from '@/lib/emotions'
import { requiresMoodCheck, requiresPreTradeGate } from '@/lib/trade-kind'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const id = positiveId((await context.params).id)
    const raw = await readJsonObject(req)
    onlyKeys(raw, ['confirmation', 'mood'])
    const confirmation = raw.confirmation
    if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
      throw new ApiError(422, 'Nutzerbestätigung fehlt.')
    }
    const source = confirmation as Record<string, unknown>
    onlyKeys(source, ['confirmedByUser', 'capturedAt'])
    if (source.confirmedByUser !== true || typeof source.capturedAt !== 'string' ||
        !Number.isFinite(Date.parse(source.capturedAt))) {
      throw new ApiError(422, 'Bestätigte Nutzeraussage mit Zeitpunkt erforderlich.')
    }
    const mood = raw.mood == null ? null : normalizeMoodCheck(raw.mood as MoodCheckInput)
    if (raw.mood != null && !mood) throw new ApiError(422, 'Ungültiger Emotions-Check-in.')

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM broker_order WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`)
      const [order] = await tx.select().from(brokerOrder).where(and(eq(brokerOrder.id, id), eq(brokerOrder.userId, userId))).limit(1)
      if (!order) throw new ApiError(404, 'Brokerbeleg nicht gefunden.')
      if (order.state !== 'filled' || !order.linkedTradeId || !order.brokerPositionId ||
          !order.filledAt || !order.executionPrice || !order.quantity) {
        throw new ApiError(409, 'Eindeutiger Fill mit Positions-ID, Kurs, Menge und Zeitpunkt erforderlich.')
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId + ':' + order.brokerAccountId + ':' + order.brokerPositionId}, 0))`)
      const [t] = await tx.select().from(trade).where(and(eq(trade.id, order.linkedTradeId),
        eq(trade.userId, userId), eq(trade.portfolioId, order.portfolioId))).limit(1)
      if (!t || t.status !== 'geplant') throw new ApiError(409, 'Verknüpfter Plan ist nicht mehr aktivierbar.')
      if (requiresPreTradeGate(t.tradeKind) && !t.preTradeAnswered) {
        throw new ApiError(409, 'Die vier Vorabfragen des Plans fehlen.')
      }
      if (requiresMoodCheck(t.tradeKind) && !mood) {
        throw new ApiError(422, 'Emotions-Check-in für diesen Plan erforderlich.')
      }
      if (t.contracts != null && t.contractInitialMargin != null && t.contractCurrency) {
        throw new ApiError(409, 'Kontraktdeckung muss vor der Aktivierung in der App geprüft werden.')
      }
      if (!t.positionSize || Math.abs(t.positionSize - order.quantity) > Math.max(1e-8, t.positionSize * 1e-6)) {
        throw new ApiError(409, 'Broker-Menge und geplante Positionsgröße weichen ab; bitte zuerst klären.')
      }
      const [changed] = await tx.update(trade).set({ status: 'aktiv', openedAt: order.filledAt,
        ...(mood ? { moodEntry: mood.score, moodEntryTags: serializeMoodTags(mood.tags), moodEntryNote: mood.note } : {}),
      }).where(and(eq(trade.id, t.id), eq(trade.userId, userId), eq(trade.status, 'geplant')))
        .returning({ id: trade.id })
      if (!changed) throw new ApiError(409, 'Trade wurde gleichzeitig geändert.')
      await tx.insert(tradeEvent).values({ tradeId: t.id, userId, type: 'eroeffnet',
        at: order.filledAt, quantity: order.quantity, price: order.executionPrice,
        note: `Broker-Fill: AvaTrade-Position ${order.brokerPositionId}`,
        payload: JSON.stringify({ source: 'broker', brokerOrderId: order.id,
          confirmationAt: new Date(source.capturedAt as string).toISOString() }),
      })
      const pending = await tx.select({ id: brokerExit.id }).from(brokerExit).where(and(
        eq(brokerExit.userId, userId), eq(brokerExit.brokerAccountId, order.brokerAccountId),
        eq(brokerExit.brokerPositionId, order.brokerPositionId), isNull(brokerExit.processedAt)))
      return { tradeId: t.id, status: 'aktiv', brokerOrderId: order.id,
        unresolvedExitIds: pending.map((row) => row.id) }
    })
    return NextResponse.json(result)
  } catch (cause) { return apiResponseError(cause) }
}

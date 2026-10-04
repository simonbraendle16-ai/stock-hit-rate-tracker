import { db } from '@/lib/db'
import { brokerExit, brokerOrder, portfolio, trade, tradeEvent } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { settlePosition } from '@/lib/trade-events'
import { classifyBrokerExit, hasConfirmedBrokerEntry } from '@/lib/broker-exit-guard'
import { normalizeSettlementReceipt, receiptSignature } from '@/lib/settlement-receipt'
import { saveSettlementReceipt } from '@/lib/settlement-service'
import { and, desc, eq, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

const keys = ['portfolioId', 'brokerAccountId', 'brokerPositionId', 'brokerExitId',
  'quantity', 'price', 'exitedAt', 'observedAt', 'settlementReceipt'] as const

function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new ApiError(422, `${label} ist ungültig.`)
  return value.trim()
}
function requiredDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new ApiError(422, `${label} ist ungültig.`)
  return new Date(value)
}
function requiredNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new ApiError(422, `${label} muss positiv sein.`)
  return value
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:read')
    const params = req.nextUrl.searchParams
    if ([...params.keys()].some((key) => !['portfolioId', 'limit', 'beforeId'].includes(key))) throw new ApiError(400, 'Unbekannter Filter.')
    const portfolioId = params.get('portfolioId') ? positiveId(params.get('portfolioId')!) : null
    const beforeId = params.get('beforeId') ? positiveId(params.get('beforeId')!) : null
    const limit = Number(params.get('limit') ?? '50')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'limit muss zwischen 1 und 100 liegen.')
    const rows = await db.select().from(brokerExit).where(and(eq(brokerExit.userId, userId),
      portfolioId == null ? undefined : eq(brokerExit.portfolioId, portfolioId),
      beforeId == null ? undefined : sql`${brokerExit.id} < ${beforeId}`))
      .orderBy(desc(brokerExit.id)).limit(limit + 1)
    return NextResponse.json({ items: rows.slice(0, limit), nextBeforeId: rows.length > limit ? rows[limit - 1].id : null })
  } catch (cause) { return apiResponseError(cause) }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const raw = await readJsonObject(req)
    onlyKeys(raw, keys)
    const input = {
      portfolioId: positiveId(String(raw.portfolioId ?? '')),
      brokerAccountId: requiredText(raw.brokerAccountId, 'Brokerkonto'),
      brokerPositionId: requiredText(raw.brokerPositionId, 'Positions-ID'),
      brokerExitId: requiredText(raw.brokerExitId, 'Ausstiegs-ID'),
      quantity: requiredNumber(raw.quantity, 'Ausstiegsmenge'),
      price: requiredNumber(raw.price, 'Ausstiegskurs'),
      exitedAt: requiredDate(raw.exitedAt, 'Ausstiegszeit'),
      observedAt: requiredDate(raw.observedAt, 'Beobachtungszeit'),
    }
    let settlementReceipt = null
    if (raw.settlementReceipt != null) {
      try { settlementReceipt = normalizeSettlementReceipt(raw.settlementReceipt) }
      catch (e) { throw new ApiError(422, e instanceof Error ? e.message : 'Abrechnung ist ungültig.') }
      if (settlementReceipt.source !== 'avatrade_history') throw new ApiError(422, 'Collector-Belegquelle ist ungültig.')
    }
    if (input.exitedAt > input.observedAt) throw new ApiError(422, 'Ausstieg liegt nach der Beobachtung.')
    if (!process.env.AVATRADE_DEMO_ACCOUNT_ID || input.brokerAccountId !== process.env.AVATRADE_DEMO_ACCOUNT_ID) {
      throw new ApiError(403, 'Brokerkonto nicht freigegeben.')
    }
    const [depot] = await db.select({ id: portfolio.id }).from(portfolio).where(and(
      eq(portfolio.id, input.portfolioId), eq(portfolio.userId, userId), eq(portfolio.kind, 'demo'))).limit(1)
    if (!depot) throw new ApiError(404, 'Demo-Depot nicht gefunden.')

    const result = await db.transaction(async (tx) => {
      // Eine Positions-ID serialisiert ihre Ausstiege, auch wenn zwei Beobachtungen parallel eintreffen.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId + ':' + input.brokerAccountId + ':' + input.brokerPositionId}, 0))`)
      const [existing] = await tx.select().from(brokerExit).where(and(eq(brokerExit.userId, userId),
        eq(brokerExit.broker, 'avatrade'), eq(brokerExit.brokerAccountId, input.brokerAccountId),
        eq(brokerExit.brokerExitId, input.brokerExitId))).limit(1)
      if (existing) {
        if (existing.brokerPositionId !== input.brokerPositionId || existing.portfolioId !== input.portfolioId ||
            existing.quantity !== input.quantity || existing.price !== input.price ||
            existing.exitedAt.getTime() !== input.exitedAt.getTime()) {
          throw new ApiError(409, 'Ausstiegs-ID widerspricht dem gespeicherten Beleg.')
        }
        if (settlementReceipt && existing.settlementReceipt &&
            receiptSignature(existing.settlementReceipt) !== receiptSignature(settlementReceipt)) {
          throw new ApiError(409, 'Abrechnungsbeleg widerspricht dem gespeicherten Beleg. Explizite Korrektur erforderlich.')
        }
        if (existing.processedAt) {
          if (settlementReceipt) {
            const linkedEvents = await tx.select().from(tradeEvent).where(and(eq(tradeEvent.userId, userId),
              eq(tradeEvent.tradeId, existing.linkedTradeId!),
              sql`${tradeEvent.payload}::jsonb ->> 'brokerExitId' = ${String(existing.id)}`)).limit(2)
            if (linkedEvents.length !== 1) throw new ApiError(409, 'Ausstiegsereignis ist nicht eindeutig zugeordnet.')
            await saveSettlementReceipt(tx, userId, linkedEvents[0].id, settlementReceipt, null)
            await tx.update(brokerExit).set({ settlementReceipt }).where(eq(brokerExit.id, existing.id))
          }
          return { ...existing, settlementReceipt: settlementReceipt ?? existing.settlementReceipt, outcome: 'processed' as const }
        }
      }
      const orders = await tx.select().from(brokerOrder).where(and(eq(brokerOrder.userId, userId),
        eq(brokerOrder.portfolioId, input.portfolioId), eq(brokerOrder.broker, 'avatrade'),
        eq(brokerOrder.brokerAccountId, input.brokerAccountId),
        eq(brokerOrder.brokerPositionId, input.brokerPositionId))).limit(2)
      const order = orders.length === 1 ? orders[0] : null
      let linkedTradeId: number | null = null
      let outcome: 'unresolved' | 'partial' | 'closed' = 'unresolved'
      let eventType: 'teilverkauf' | 'geschlossen' | null = null
      let result: 'gewinn' | 'verlust' | 'breakeven' | null = null
      if (order?.linkedTradeId && order.state === 'filled' && order.filledAt && input.exitedAt >= order.filledAt) {
        const [t] = await tx.select().from(trade).where(and(eq(trade.id, order.linkedTradeId),
          eq(trade.userId, userId), eq(trade.portfolioId, input.portfolioId), eq(trade.status, 'aktiv'))).limit(1)
        if (t) {
          const events = await tx.select().from(tradeEvent).where(and(eq(tradeEvent.tradeId, t.id),
            eq(tradeEvent.userId, userId))).orderBy(tradeEvent.at, tradeEvent.id)
          const verifiedEntry = hasConfirmedBrokerEntry(order, events)
          const settlement = settlePosition(t, events)
          const remaining = settlement.openQty
          const classification = classifyBrokerExit(remaining, input.quantity)
          if (verifiedEntry && classification !== 'unresolved') {
            linkedTradeId = t.id
            const full = classification === 'closed'
            eventType = full ? 'geschlossen' : 'teilverkauf'
            outcome = full ? 'closed' : 'partial'
          }
        }
      }
      const [saved] = existing ? await tx.update(brokerExit).set({
        brokerOrderId: order?.id ?? null, linkedTradeId,
        settlementReceipt: settlementReceipt ?? existing.settlementReceipt,
        processedAt: eventType ? new Date() : null,
      }).where(eq(brokerExit.id, existing.id)).returning()
        : await tx.insert(brokerExit).values({ ...input, settlementReceipt, userId, broker: 'avatrade',
          brokerOrderId: order?.id ?? null, linkedTradeId, processedAt: eventType ? new Date() : null,
        }).returning()
      if (eventType && linkedTradeId) {
        const [event] = await tx.insert(tradeEvent).values({ tradeId: linkedTradeId, userId, type: eventType,
          at: input.exitedAt, quantity: input.quantity, price: input.price,
          note: `Broker-Ausstieg: AvaTrade ${input.brokerExitId}`,
          payload: JSON.stringify({ source: 'broker', brokerExitId: saved.id }),
        }).returning()
        const receipt = settlementReceipt ?? saved.settlementReceipt
        if (receipt) await saveSettlementReceipt(tx, userId, event.id, receipt, null)
        if (eventType === 'geschlossen') {
          const [t] = await tx.select().from(trade).where(eq(trade.id, linkedTradeId))
          const events = await tx.select().from(tradeEvent).where(and(eq(tradeEvent.tradeId, linkedTradeId), eq(tradeEvent.userId, userId)))
          const settlement = settlePosition(t, events)
          if (settlement.moneyComplete && Number.isFinite(settlement.totalNet)) {
            result = Math.abs(settlement.totalNet) < 1e-8 ? 'breakeven' : settlement.totalNet > 0 ? 'gewinn' : 'verlust'
          }
          const [changed] = await tx.update(trade).set({ status: 'abgeschlossen', result,
            actualExitPrice: input.price, closedAt: input.exitedAt,
            version: sql`${trade.version} + 1`,
          }).where(and(eq(trade.id, linkedTradeId), eq(trade.userId, userId), eq(trade.status, 'aktiv')))
            .returning({ id: trade.id })
          if (!changed) throw new ApiError(409, 'Trade wurde gleichzeitig geändert.')
        }
      }
      return { ...saved, outcome }
    })
    return NextResponse.json(result)
  } catch (cause) { return apiResponseError(cause) }
}

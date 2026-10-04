import { NextRequest, NextResponse } from 'next/server'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trade, tradeSettlementReceipt } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope, versionFromHeader } from '@/lib/assistant-api'
import { saveSettlementReceipt } from '@/lib/settlement-service'

type Context = { params: Promise<{ id: string }> }

async function owner(userId: string, id: number) {
  const [t] = await db.select({ id: trade.id }).from(trade).where(and(eq(trade.id, id), eq(trade.userId, userId))).limit(1)
  if (!t) throw new ApiError(404, 'Trade nicht gefunden.')
}
export async function GET(req: NextRequest, context: Context) {
  try {
    const userId = await requireApiScope(req, 'trades:read')
    const id = positiveId((await context.params).id)
    await owner(userId, id)
    const items = await db.select().from(tradeSettlementReceipt).where(and(eq(tradeSettlementReceipt.tradeId, id),
      eq(tradeSettlementReceipt.userId, userId))).orderBy(asc(tradeSettlementReceipt.eventId), asc(tradeSettlementReceipt.version))
    return NextResponse.json({ items })
  } catch (e) { return apiResponseError(e) }
}
async function write(req: NextRequest, context: Context, correction: boolean) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const id = positiveId((await context.params).id)
    await owner(userId, id)
    const raw = await readJsonObject(req)
    onlyKeys(raw, ['eventId', 'receipt', 'correctionReason'])
    const eventId = positiveId(String(raw.eventId ?? ''))
    const receipt = raw.receipt as Record<string, unknown> | undefined
    if (receipt?.source !== 'manual_broker_receipt') throw new ApiError(422, 'Manuelle Erfassung verlangt eine Brokerbelegquelle.')
    const version = correction ? versionFromHeader(req) : 0
    const saved = await db.transaction(async tx => {
      // Prevent a route for trade A from writing an event belonging to trade B.
      const { tradeEvent } = await import('@/lib/db/schema')
      const [event] = await tx.select({ id: tradeEvent.id }).from(tradeEvent).where(and(eq(tradeEvent.id, eventId),
        eq(tradeEvent.tradeId, id), eq(tradeEvent.userId, userId))).limit(1)
      if (!event) throw new ApiError(404, 'Ausstiegsereignis nicht gefunden.')
      return saveSettlementReceipt(tx, userId, eventId, receipt, version,
        typeof raw.correctionReason === 'string' ? raw.correctionReason : null)
    })
    return NextResponse.json(saved)
  } catch (e) { return apiResponseError(e) }
}
export async function POST(req: NextRequest, context: Context) { return write(req, context, false) }
export async function PATCH(req: NextRequest, context: Context) { return write(req, context, true) }

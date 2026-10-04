import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { portfolio, trade, tradeEvent, tradeSettlementReceipt } from '@/lib/db/schema'
import { ApiError } from './assistant-api'
import { normalizeSettlementReceipt, receiptSignature } from './settlement-receipt'
import { settlePosition } from './trade-events'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Both UI and collector use the same ownership, revision and projection gate. */
export async function saveSettlementReceipt(tx: Tx, userId: string, eventId: number,
  raw: unknown, expectedVersion: number | null, correctionReason?: string | null) {
  let receipt
  try { receipt = normalizeSettlementReceipt(raw) } catch (e) {
    throw new ApiError(422, e instanceof Error ? e.message : 'Ungültiger Abrechnungsbeleg.')
  }
  const [event] = await tx.select().from(tradeEvent).where(and(eq(tradeEvent.id, eventId), eq(tradeEvent.userId, userId))).limit(1)
  if (!event || !['teilverkauf', 'geschlossen'].includes(event.type)) throw new ApiError(404, 'Ausstiegsereignis nicht gefunden.')
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'settlement:' + userId + ':' + event.tradeId}, 0))`)
  const [t] = await tx.select().from(trade).where(and(eq(trade.id, event.tradeId), eq(trade.userId, userId))).limit(1)
  if (!t) throw new ApiError(404, 'Trade nicht gefunden.')
  const [depot] = await tx.select().from(portfolio).where(and(eq(portfolio.id, t.portfolioId), eq(portfolio.userId, userId))).limit(1)
  const accountCurrency = t.accountCurrency ?? depot?.currency
  if (!accountCurrency || receipt.currency !== accountCurrency) throw new ApiError(422, 'Beleg muss in der bestätigten Depotwährung abgerechnet sein.')
  if (Date.parse(receipt.capturedAt) < event.at.getTime() || Date.parse(receipt.capturedAt) > Date.now() + 60_000) {
    throw new ApiError(422, 'Belegbeobachtung liegt vor dem Ausstieg oder in der Zukunft.')
  }
  const [current] = await tx.select().from(tradeSettlementReceipt).where(and(
    eq(tradeSettlementReceipt.eventId, eventId), eq(tradeSettlementReceipt.userId, userId)))
    .orderBy(desc(tradeSettlementReceipt.version)).limit(1)
  if (current && receiptSignature(current.receipt) === receiptSignature(receipt)) return current
  const version = current?.version ?? 0
  if ((expectedVersion ?? 0) !== version) throw new ApiError(409, 'Abrechnung wurde bereits gespeichert oder geändert. Aktuellen Beleg lesen.')
  if (current && (!correctionReason?.trim() || correctionReason.length > 2000)) throw new ApiError(422, 'Belegkorrektur benötigt eine Begründung.')
  const [saved] = await tx.insert(tradeSettlementReceipt).values({ userId, tradeId: t.id,
    eventId, version: version + 1, receipt, correctionReason: current ? correctionReason!.trim() : null }).returning()
  let payload: Record<string, unknown> = {}
  try { payload = JSON.parse(event.payload ?? '{}') } catch { /* Preserve original in revision reference. */ }
  await tx.update(tradeEvent).set({ payload: JSON.stringify({ ...payload, settlement: receipt,
    settlementReceiptId: saved.id, settlementVersion: saved.version }) }).where(eq(tradeEvent.id, eventId))
  if (t.status === 'abgeschlossen') {
    const events = await tx.select().from(tradeEvent).where(and(eq(tradeEvent.tradeId, t.id), eq(tradeEvent.userId, userId)))
    const settlement = settlePosition(t, events)
    const result = settlement.moneyComplete && settlement.isFullyClosed && Number.isFinite(settlement.totalNet)
      ? Math.abs(settlement.totalNet) < 1e-8 ? 'breakeven' : settlement.totalNet > 0 ? 'gewinn' : 'verlust'
      : null
    await tx.update(trade).set({ result, version: sql`${trade.version} + 1` }).where(eq(trade.id, t.id))
  }
  return saved
}

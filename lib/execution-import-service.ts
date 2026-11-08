import { and, eq } from 'drizzle-orm'
import { db, inDatabaseTransaction } from './db'
import { portfolio, trade } from './db/schema'
import { ApiError, hashToken } from './assistant-api'
import { normalizeExecutionImport } from './execution-import'
import { canonicalBody } from './assistant-trade-input'

export async function importExecution(userId: string, raw: Record<string,unknown>) {
  let input: ReturnType<typeof normalizeExecutionImport>
  try { input = normalizeExecutionImport(raw) } catch(e) { throw new ApiError(422, (e as Error).message) }
  const e = input.execution
  // Stable identity across observation times and all closings. A later changed
  // statement is a conflict, never a second booking or an implicit correction.
  const key = `match-trader:${hashToken(`${e.accountFingerprint}:${e.positionId}`)}`
  const hash = hashToken(canonicalBody({ ...input, capturedAt: undefined }))
  return inDatabaseTransaction(async () => {
    const [depot] = await db.select().from(portfolio).where(and(eq(portfolio.id,input.portfolioId),eq(portfolio.userId,userId))).for('update')
    if (!depot || depot.kind !== 'demo' || depot.currency !== 'USD' || depot.archivedAt) throw new ApiError(422,'Aktives USD-Demodepot erforderlich.')
    const [existing] = await db.select().from(trade).where(and(eq(trade.userId,userId),eq(trade.externalRequestKey,key))).limit(1)
    if (existing) {
      if (existing.externalRequestHash !== hash) throw new ApiError(409,'Brokerposition bereits mit anderem Beleg importiert. Gezielte Korrektur erforderlich.')
      return { row: existing, created: false }
    }
    const closed = e.closeTime !== null
    const [row] = await db.insert(trade).values({
      userId, portfolioId:input.portfolioId, ticker:input.ticker, market:input.market,
      direction:input.direction, tradeKind:'schnell', broker:'Match-Trader / E8 Markets',
      externalRequestKey:key, externalRequestHash:hash,
      externalSource:{kind:'broker_execution_import',capturedAt:input.capturedAt,execution:e},
      entryPrice:e.openPrice, stopLoss:null, takeProfit:null, positionSize:null,
      accountCurrency:e.currency, quoteCurrency:null, quoteToAccountRate:null,
      tradedWithMoney:false, alertsEnabled:false,
      status:closed?'abgeschlossen':'aktiv', openedAt:new Date(e.openTime),
      closedAt:closed?new Date(e.closeTime!):null, actualExitPrice:e.closePrice,
      result:closed?(e.net!>0?'gewinn':e.net!<0?'verlust':'breakeven'):null,
      notes:'Aus Match-Trader übernommen. Tatsächliche Ausführung und Brokerergebnis; ursprünglicher Plan und Anfangsrisiko nicht erfasst. Menge im Beleg in Lots, keine Umdeutung in Stück.',
    }).returning()
    return {row,created:true}
  })
}

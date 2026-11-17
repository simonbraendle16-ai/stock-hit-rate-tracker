import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { trade, tradeEvent } from './db/schema'
import { ApiError, hashToken, onlyKeys } from './assistant-api'
import { canonicalBody } from './assistant-trade-input'
import { importedExecution, normalizeExecutionImport } from './execution-import'
import { publicTrade } from './trade-mutation-service'

/** Called only inside mutateTrade's owner/depot lock, version and idempotency gate. */
export async function closeImportedExecution(userId: string, row: typeof trade.$inferSelect, body: Record<string, unknown>) {
  onlyKeys(body, ['import', 'reason'])
  if (!body.import || typeof body.import !== 'object' || Array.isArray(body.import)) throw new ApiError(422, 'Vollständiger Abschlussbeleg erforderlich.')
  if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000) throw new ApiError(422, 'Abgleichgrund erforderlich.')
  let input: ReturnType<typeof normalizeExecutionImport>
  try { input = normalizeExecutionImport(body.import as Record<string, unknown>) } catch (e) { throw new ApiError(422, (e as Error).message) }
  const before = importedExecution(row), after = input.execution
  if (row.userId !== userId || !before || row.status !== 'aktiv' || before.closeTime !== null || after.closeTime === null) throw new ApiError(422, 'Nur eine offen importierte Brokerposition kann mit einem Abschlussbeleg ergänzt werden.')
  if (input.portfolioId !== row.portfolioId || input.ticker !== row.ticker || input.market !== row.market || input.direction !== row.direction) throw new ApiError(422, 'Depot oder Tradezuordnung widerspricht dem Original.')
  for (const key of ['broker', 'accountFingerprint', 'positionId', 'volumeLots', 'openTime', 'openPrice', 'currency'] as const) {
    if (before[key] !== after[key]) throw new ApiError(422, 'Eröffnungsbeleg oder Brokeridentität darf beim Abschluss nicht geändert werden.')
  }
  if (Date.parse(input.capturedAt) < Date.parse(row.externalSource!.capturedAt)) throw new ApiError(422, 'Abschlussbeobachtung liegt vor dem vorhandenen Beleg.')
  const hash = hashToken(canonicalBody({ ...input, capturedAt: undefined }))
  const [saved] = await db.update(trade).set({
    externalSource: { kind: 'broker_execution_import', capturedAt: input.capturedAt, execution: after },
    externalRequestHash: hash, status: 'abgeschlossen', closedAt: new Date(after.closeTime!),
    actualExitPrice: after.closePrice, result: after.net! > 0 ? 'gewinn' : after.net! < 0 ? 'verlust' : 'breakeven',
    version: row.version + 1,
  }).where(and(eq(trade.id, row.id), eq(trade.userId, userId))).returning()
  // A note preserves the original receipt without fabricating a units-based exit event.
  await db.insert(tradeEvent).values({ userId, tradeId: row.id, type: 'notiz', at: new Date(input.capturedAt),
    note: 'Brokerabschluss nachgetragen: ' + body.reason.trim(),
    payload: JSON.stringify({ kind: 'broker_execution_close', before: row.externalSource, after: saved.externalSource,
      source: { kind: 'broker_history', capturedAt: input.capturedAt }, reason: body.reason.trim() }) })
  return publicTrade(saved)
}

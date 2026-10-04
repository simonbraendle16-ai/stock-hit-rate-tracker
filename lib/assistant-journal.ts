import { db } from '@/lib/db'
import { insight, journalEntry, trade } from '@/lib/db/schema'
import { ApiError, positiveId } from '@/lib/assistant-api'
import { normalizeInsightInput, normalizeJournalInput, type EvidenceRef, type InsightInput, type JournalInput } from '@/lib/journal'
import { and, eq, inArray } from 'drizzle-orm'

export const JOURNAL_FIELDS = ['tradeId', 'occurredAt', 'kind', 'situation', 'intention', 'action', 'thoughts', 'reflection', 'ruleRef', 'sourceRefs']
export const INSIGHT_FIELDS = ['statement', 'area', 'status', 'evidenceRefs', 'counterEvidenceRefs', 'limits', 'proposal']

export function journalValues(input: Record<string, unknown>) {
  try { return normalizeJournalInput(input as JournalInput) }
  catch (cause) { throw new ApiError(422, cause instanceof Error ? cause.message : 'Ungültige Journalangaben.') }
}

export function insightValues(input: Record<string, unknown>) {
  try { return normalizeInsightInput(input as InsightInput) }
  catch (cause) { throw new ApiError(422, cause instanceof Error ? cause.message : 'Ungültige Erkenntnisangaben.') }
}

export async function assertOwnTrade(userId: string, tradeId: number | null) {
  if (tradeId == null) return
  const [owned] = await db.select({ id: trade.id }).from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId))).limit(1)
  if (!owned) throw new ApiError(404, 'Trade nicht gefunden.')
}

export async function assertOwnEvidence(userId: string, refs: EvidenceRef[]) {
  const tradeIds = [...new Set(refs.filter((ref) => ref.kind === 'trade').map((ref) => positiveId(ref.id)))]
  const journalIds = [...new Set(refs.filter((ref) => ref.kind === 'journal').map((ref) => ref.id))]
  if (tradeIds.length) {
    const rows = await db.select({ id: trade.id }).from(trade)
      .where(and(eq(trade.userId, userId), inArray(trade.id, tradeIds)))
    if (rows.length !== tradeIds.length) throw new ApiError(404, 'Mindestens ein Trade-Beleg ist nicht verfügbar.')
  }
  if (journalIds.length) {
    const rows = await db.select({ id: journalEntry.id }).from(journalEntry)
      .where(and(eq(journalEntry.userId, userId), inArray(journalEntry.id, journalIds)))
    if (rows.length !== journalIds.length) throw new ApiError(404, 'Mindestens ein Journal-Beleg ist nicht verfügbar.')
  }
}

export function listLimit(params: URLSearchParams) {
  const raw = params.get('limit') ?? '50'
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 100) throw new ApiError(400, 'limit muss zwischen 1 und 100 liegen.')
  return Number(raw)
}

export function encodeCursor(date: Date, id: string) {
  return Buffer.from(JSON.stringify([date.toISOString(), id])).toString('base64url')
}

export function decodeCursor(raw: string | null): { date: Date; id: string } | null {
  if (raw == null) return null
  if (raw.length > 200) throw new ApiError(400, 'Ungültiger Cursor.')
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' ||
        typeof value[1] !== 'string' || !/^[0-9a-f-]{36}$/i.test(value[1])) throw new Error()
    const date = new Date(value[0])
    if (!Number.isFinite(date.getTime())) throw new Error()
    return { date, id: value[1] }
  } catch { throw new ApiError(400, 'Ungültiger Cursor.') }
}

export function publicRow<T extends { userId: string }>(row: T): Omit<T, 'userId'> {
  const { userId: _userId, ...publicData } = row
  return publicData
}

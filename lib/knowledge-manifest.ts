import { db } from '@/lib/db'
import { trade, journalEntry, insight, tradeEvent, tradeTarget, tradeEventRevision } from '@/lib/db/schema'
import { fingerprint } from './knowledge-content.mjs'
import { and, eq, inArray, getTableColumns } from 'drizzle-orm'
import { createHash } from 'node:crypto'

// Project at the SQL boundary: discarded columns must never cross the network.
// Keep these fields aligned with knowledgePayload; the database regression suite
// compares complete rows against this projection, including every child column.
const tradeColumns = {
  id: trade.id,
  version: trade.version,
  ticker: trade.ticker,
  direction: trade.direction,
  status: trade.status,
  notes: trade.notes,
  strategy: trade.strategy,
  setupTags: trade.setupTags,
  planContext: trade.planContext,
  elliottWaveCount: trade.elliottWaveCount,
  waveDegree: trade.waveDegree,
  elliottInvalidation: trade.elliottInvalidation,
  preTradeAnswers: trade.preTradeAnswers,
  moodEntryNote: trade.moodEntryNote,
  moodExitNote: trade.moodExitNote,
  noTradeNote: trade.noTradeNote,
  externalSource: trade.externalSource,
}
const journalEntryColumns = {
  id: journalEntry.id,
  version: journalEntry.version,
  tradeId: journalEntry.tradeId,
  occurredAt: journalEntry.occurredAt,
  kind: journalEntry.kind,
  situation: journalEntry.situation,
  intention: journalEntry.intention,
  action: journalEntry.action,
  thoughts: journalEntry.thoughts,
  reflection: journalEntry.reflection,
  ruleRef: journalEntry.ruleRef,
  sourceRefs: journalEntry.sourceRefs,
}
const insightColumns = {
  id: insight.id,
  version: insight.version,
  statement: insight.statement,
  area: insight.area,
  status: insight.status,
  evidenceRefs: insight.evidenceRefs,
  counterEvidenceRefs: insight.counterEvidenceRefs,
  limits: insight.limits,
  proposal: insight.proposal,
}
// Child payloads intentionally include all columns except request/owner metadata.
const { userId: _eventOwner, ...eventColumns } = getTableColumns(tradeEvent)
const { userId: _targetOwner, ...targetColumns } = getTableColumns(tradeTarget)
const { userId: _revisionOwner, ...revisionColumns } = getTableColumns(tradeEventRevision)

export async function knowledgeManifest(userId: string) {
  return db.transaction(async tx => {
    // One repeatable-read snapshot and six batched reads; no per-trade queries or newest-page limitation.
    const trades = await tx.select(tradeColumns).from(trade).where(eq(trade.userId, userId))
    const journals = await tx.select(journalEntryColumns).from(journalEntry).where(eq(journalEntry.userId, userId))
    const insights = await tx.select(insightColumns).from(insight).where(eq(insight.userId, userId))
    const ids = trades.map(row => row.id)
    const events = ids.length ? await tx.select(eventColumns).from(tradeEvent).where(and(eq(tradeEvent.userId, userId), inArray(tradeEvent.tradeId, ids))) : []
    const targets = ids.length ? await tx.select(targetColumns).from(tradeTarget).where(and(eq(tradeTarget.userId, userId), inArray(tradeTarget.tradeId, ids))) : []
    const revisions = ids.length ? await tx.select(revisionColumns).from(tradeEventRevision).where(and(eq(tradeEventRevision.userId, userId), inArray(tradeEventRevision.tradeId, ids))) : []
    const items = [
      ...trades.map(row => ({ type: 'trade' as const, id: String(row.id), version: row.version,
        fingerprint: fingerprint('trade', { ...row, events: events.filter(e => e.tradeId === row.id), targets: targets.filter(t => t.tradeId === row.id), eventRevisions: revisions.filter(r => r.tradeId === row.id) }) })),
      ...journals.map(row => ({ type: 'journal' as const, id: row.id, version: row.version, fingerprint: fingerprint('journal', row) })),
      ...insights.map(row => ({ type: 'insight' as const, id: row.id, version: row.version, fingerprint: fingerprint('insight', row) })),
    ].sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))
    const etag = `"${createHash('sha256').update(JSON.stringify(items)).digest('hex')}"`
    return { items, etag, complete: true as const, schemaVersion: 1 }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

import { db } from '@/lib/db'
import { trade, journalEntry, insight, tradeEvent, tradeTarget, tradeEventRevision } from '@/lib/db/schema'
import { fingerprint } from './knowledge-content.mjs'
import { and, eq, inArray } from 'drizzle-orm'
import { createHash } from 'node:crypto'

export async function knowledgeManifest(userId: string) {
  return db.transaction(async tx => {
    // One repeatable-read snapshot and six batched reads; no per-trade queries or newest-page limitation.
    const trades = await tx.select().from(trade).where(eq(trade.userId, userId))
    const journals = await tx.select().from(journalEntry).where(eq(journalEntry.userId, userId))
    const insights = await tx.select().from(insight).where(eq(insight.userId, userId))
    const ids = trades.map(row => row.id)
    const events = ids.length ? await tx.select().from(tradeEvent).where(and(eq(tradeEvent.userId, userId), inArray(tradeEvent.tradeId, ids))) : []
    const targets = ids.length ? await tx.select().from(tradeTarget).where(and(eq(tradeTarget.userId, userId), inArray(tradeTarget.tradeId, ids))) : []
    const revisions = ids.length ? await tx.select().from(tradeEventRevision).where(and(eq(tradeEventRevision.userId, userId), inArray(tradeEventRevision.tradeId, ids))) : []
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

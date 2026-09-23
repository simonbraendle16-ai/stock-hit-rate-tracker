'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { insight, journalEntry, trade } from '@/lib/db/schema'
import { normalizeInsightInput, normalizeJournalInput, type EvidenceRef, type InsightInput, type JournalInput } from '@/lib/journal'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Nicht angemeldet.')
  return session.user.id
}

async function assertOwnTrade(userId: string, tradeId: number | null) {
  if (tradeId == null) return
  const [owned] = await db.select({ id: trade.id }).from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId))).limit(1)
  if (!owned) throw new Error('Trade nicht gefunden.')
}

async function assertOwnEvidence(userId: string, refs: EvidenceRef[]) {
  const tradeIds = [...new Set(refs.filter((ref) => ref.kind === 'trade').map((ref) => Number(ref.id)))]
  const journalIds = [...new Set(refs.filter((ref) => ref.kind === 'journal').map((ref) => ref.id))]
  if (tradeIds.length) {
    const rows = await db.select({ id: trade.id }).from(trade)
      .where(and(eq(trade.userId, userId), inArray(trade.id, tradeIds)))
    if (rows.length !== tradeIds.length) throw new Error('Mindestens ein Trade-Beleg ist nicht verfügbar.')
  }
  if (journalIds.length) {
    const rows = await db.select({ id: journalEntry.id }).from(journalEntry)
      .where(and(eq(journalEntry.userId, userId), inArray(journalEntry.id, journalIds)))
    if (rows.length !== journalIds.length) throw new Error('Mindestens ein Journal-Beleg ist nicht verfügbar.')
  }
}

export async function listJournalEntries(tradeId?: number) {
  const userId = await getUserId()
  if (tradeId != null) await assertOwnTrade(userId, tradeId)
  return db.select().from(journalEntry)
    .where(and(eq(journalEntry.userId, userId), tradeId == null ? undefined : eq(journalEntry.tradeId, tradeId)))
    .orderBy(desc(journalEntry.occurredAt), desc(journalEntry.createdAt)).limit(100)
}

export async function listOwnTradesForJournal() {
  const userId = await getUserId()
  return db.select({ id: trade.id, ticker: trade.ticker, status: trade.status, createdAt: trade.createdAt })
    .from(trade).where(eq(trade.userId, userId)).orderBy(desc(trade.createdAt)).limit(200)
}

export async function createJournalEntry(input: JournalInput) {
  const userId = await getUserId()
  const values = normalizeJournalInput(input)
  await assertOwnTrade(userId, values.tradeId)
  const [created] = await db.insert(journalEntry).values({ ...values, userId }).returning()
  revalidatePath('/journal')
  if (values.tradeId != null) revalidatePath(`/trades/${values.tradeId}`)
  return created
}

export async function updateJournalEntry(id: string, version: number, input: JournalInput) {
  const userId = await getUserId()
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Ungültige Version.')
  const values = normalizeJournalInput(input)
  await assertOwnTrade(userId, values.tradeId)
  const [updated] = await db.update(journalEntry)
    .set({ ...values, version: version + 1, updatedAt: new Date() })
    .where(and(eq(journalEntry.id, id), eq(journalEntry.userId, userId), eq(journalEntry.version, version)))
    .returning()
  if (!updated) throw new Error('Notiz nicht gefunden oder inzwischen geändert. Bitte neu laden.')
  revalidatePath('/journal')
  if (updated.tradeId != null) revalidatePath(`/trades/${updated.tradeId}`)
  return updated
}

export async function listInsights(status?: string) {
  const userId = await getUserId()
  const allowed = ['hypothesis', 'supported', 'contradicted', 'discarded']
  if (status && !allowed.includes(status)) throw new Error('Ungültiger Erkenntnisstatus.')
  return db.select().from(insight)
    .where(and(eq(insight.userId, userId), status ? eq(insight.status, status) : undefined))
    .orderBy(desc(insight.updatedAt)).limit(100)
}

export async function createInsight(input: InsightInput) {
  const userId = await getUserId()
  const values = normalizeInsightInput(input)
  await assertOwnEvidence(userId, [...values.evidenceRefs, ...values.counterEvidenceRefs])
  const [created] = await db.insert(insight).values({ ...values, userId }).returning()
  revalidatePath('/journal')
  return created
}

export async function updateInsight(id: string, version: number, input: InsightInput) {
  const userId = await getUserId()
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Ungültige Version.')
  const values = normalizeInsightInput(input)
  await assertOwnEvidence(userId, [...values.evidenceRefs, ...values.counterEvidenceRefs])
  const [updated] = await db.update(insight)
    .set({ ...values, version: version + 1, updatedAt: new Date() })
    .where(and(eq(insight.id, id), eq(insight.userId, userId), eq(insight.version, version)))
    .returning()
  if (!updated) throw new Error('Erkenntnis nicht gefunden oder inzwischen geändert. Bitte neu laden.')
  revalidatePath('/journal')
  return updated
}

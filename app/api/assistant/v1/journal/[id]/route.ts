import { db } from '@/lib/db'
import { journalEntry } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, readJsonObject, requireApiScope, uuidId, versionFromHeader } from '@/lib/assistant-api'
import { assertOwnTrade, JOURNAL_FIELDS, journalValues, publicRow } from '@/lib/assistant-journal'
import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, context: Context) {
  try {
    const userId = await requireApiScope(req, 'journal:read')
    const id = uuidId((await context.params).id)
    const [row] = await db.select().from(journalEntry)
      .where(and(eq(journalEntry.id, id), eq(journalEntry.userId, userId))).limit(1)
    if (!row) throw new ApiError(404, 'Journaleintrag nicht gefunden.')
    return NextResponse.json(publicRow(row))
  } catch (cause) { return apiResponseError(cause) }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const userId = await requireApiScope(req, 'journal:write')
    const id = uuidId((await context.params).id)
    const version = versionFromHeader(req)
    const input = await readJsonObject(req)
    onlyKeys(input, JOURNAL_FIELDS)
    const [existing] = await db.select().from(journalEntry)
      .where(and(eq(journalEntry.id, id), eq(journalEntry.userId, userId))).limit(1)
    if (!existing) throw new ApiError(404, 'Journaleintrag nicht gefunden.')
    if (existing.version !== version) throw new ApiError(409, 'Eintrag wurde inzwischen geändert.')
    const values = journalValues({ ...existing, ...input, kind: existing.kind })
    await assertOwnTrade(userId, values.tradeId)
    const [row] = await db.update(journalEntry).set({ ...values, version: version + 1, updatedAt: new Date() })
      .where(and(eq(journalEntry.id, id), eq(journalEntry.userId, userId), eq(journalEntry.version, version))).returning()
    if (!row) throw new ApiError(409, 'Eintrag wurde inzwischen geändert.')
    return NextResponse.json(publicRow(row))
  } catch (cause) { return apiResponseError(cause) }
}

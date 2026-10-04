import { db } from '@/lib/db'
import { journalEntry } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { assertOwnTrade, decodeCursor, encodeCursor, JOURNAL_FIELDS, journalValues, listLimit, publicRow } from '@/lib/assistant-journal'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'journal:read')
    const params = req.nextUrl.searchParams
    if ([...params.keys()].some((key) => !['tradeId', 'limit', 'cursor'].includes(key))) throw new ApiError(400, 'Unbekannter Filter.')
    const tradeId = params.get('tradeId') ? positiveId(params.get('tradeId')!) : null
    if (tradeId != null) await assertOwnTrade(userId, tradeId)
    const limit = listLimit(params)
    const cursor = decodeCursor(params.get('cursor'))
    const rows = await db.select().from(journalEntry).where(and(
      eq(journalEntry.userId, userId),
      tradeId == null ? undefined : eq(journalEntry.tradeId, tradeId),
      cursor ? or(lt(journalEntry.occurredAt, cursor.date),
        and(eq(journalEntry.occurredAt, cursor.date), lt(journalEntry.id, cursor.id))) : undefined,
    )).orderBy(desc(journalEntry.occurredAt), desc(journalEntry.id)).limit(limit + 1)
    const page = rows.slice(0, limit)
    return NextResponse.json({ items: page.map(publicRow), nextCursor: rows.length > limit && page.length
      ? encodeCursor(page[page.length - 1].occurredAt, page[page.length - 1].id) : null })
  } catch (cause) { return apiResponseError(cause) }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'journal:write')
    const input = await readJsonObject(req)
    onlyKeys(input, JOURNAL_FIELDS.filter((field) => field !== 'kind'))
    // Externe Einträge tragen ihre Herkunft sichtbar; keine stille Zuschreibung als Nutzernotiz.
    const values = journalValues({ ...input, kind: 'assistant_interpretation' })
    await assertOwnTrade(userId, values.tradeId)
    const [row] = await db.insert(journalEntry).values({ ...values, userId }).returning()
    return NextResponse.json(publicRow(row), { status: 201 })
  } catch (cause) { return apiResponseError(cause) }
}

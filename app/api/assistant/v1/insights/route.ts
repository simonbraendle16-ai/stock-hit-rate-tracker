import { db } from '@/lib/db'
import { insight } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { assertOwnEvidence, decodeCursor, encodeCursor, INSIGHT_FIELDS, insightValues, listLimit, publicRow } from '@/lib/assistant-journal'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'journal:read')
    const params = req.nextUrl.searchParams
    if ([...params.keys()].some((key) => !['status', 'limit', 'cursor'].includes(key))) throw new ApiError(400, 'Unbekannter Filter.')
    const status = params.get('status')
    if (status && !['hypothesis', 'supported', 'contradicted', 'discarded'].includes(status)) throw new ApiError(400, 'Unbekannter Status.')
    const limit = listLimit(params)
    const cursor = decodeCursor(params.get('cursor'))
    const rows = await db.select().from(insight).where(and(
      eq(insight.userId, userId), status ? eq(insight.status, status) : undefined,
      cursor ? or(lt(insight.updatedAt, cursor.date),
        and(eq(insight.updatedAt, cursor.date), lt(insight.id, cursor.id))) : undefined,
    )).orderBy(desc(insight.updatedAt), desc(insight.id)).limit(limit + 1)
    const page = rows.slice(0, limit)
    return NextResponse.json({ items: page.map(publicRow), nextCursor: rows.length > limit && page.length
      ? encodeCursor(page[page.length - 1].updatedAt, page[page.length - 1].id) : null })
  } catch (cause) { return apiResponseError(cause) }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'journal:write')
    const input = await readJsonObject(req)
    onlyKeys(input, INSIGHT_FIELDS)
    const values = insightValues(input)
    await assertOwnEvidence(userId, [...values.evidenceRefs, ...values.counterEvidenceRefs])
    const [row] = await db.insert(insight).values({ ...values, userId }).returning()
    return NextResponse.json(publicRow(row), { status: 201 })
  } catch (cause) { return apiResponseError(cause) }
}

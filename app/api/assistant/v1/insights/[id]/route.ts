import { db } from '@/lib/db'
import { insight } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, readJsonObject, requireApiScope, uuidId, versionFromHeader } from '@/lib/assistant-api'
import { assertOwnEvidence, INSIGHT_FIELDS, insightValues, publicRow } from '@/lib/assistant-journal'
import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

type Context = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, context: Context) {
  try {
    const userId = await requireApiScope(req, 'journal:read')
    const id = uuidId((await context.params).id)
    const [row] = await db.select().from(insight)
      .where(and(eq(insight.id, id), eq(insight.userId, userId))).limit(1)
    if (!row) throw new ApiError(404, 'Erkenntnis nicht gefunden.')
    return NextResponse.json(publicRow(row))
  } catch (cause) { return apiResponseError(cause) }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const userId = await requireApiScope(req, 'journal:write')
    const id = uuidId((await context.params).id)
    const version = versionFromHeader(req)
    const input = await readJsonObject(req)
    onlyKeys(input, INSIGHT_FIELDS)
    const [existing] = await db.select().from(insight)
      .where(and(eq(insight.id, id), eq(insight.userId, userId))).limit(1)
    if (!existing) throw new ApiError(404, 'Erkenntnis nicht gefunden.')
    if (existing.version !== version) throw new ApiError(409, 'Erkenntnis wurde inzwischen geändert.')
    const values = insightValues({ ...existing, ...input })
    await assertOwnEvidence(userId, [...values.evidenceRefs, ...values.counterEvidenceRefs])
    const [row] = await db.update(insight).set({ ...values, version: version + 1, updatedAt: new Date() })
      .where(and(eq(insight.id, id), eq(insight.userId, userId), eq(insight.version, version))).returning()
    if (!row) throw new ApiError(409, 'Erkenntnis wurde inzwischen geändert.')
    return NextResponse.json(publicRow(row))
  } catch (cause) { return apiResponseError(cause) }
}

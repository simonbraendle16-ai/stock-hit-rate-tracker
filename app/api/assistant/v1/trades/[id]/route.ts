import { db } from '@/lib/db'
import { trade, tradeEvent, tradeTarget } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope, versionFromHeader } from '@/lib/assistant-api'
import { serializeSetupTags } from '@/lib/setups'
import { and, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiScope(req, 'trades:read')
    const id = positiveId((await context.params).id)
    const [row] = await db.select().from(trade)
      .where(and(eq(trade.id, id), eq(trade.userId, userId))).limit(1)
    if (!row) throw new ApiError(404, 'Trade nicht gefunden.')
    const [events, targets] = await Promise.all([
      db.select().from(tradeEvent).where(and(eq(tradeEvent.tradeId, id), eq(tradeEvent.userId, userId))),
      db.select().from(tradeTarget).where(and(eq(tradeTarget.tradeId, id), eq(tradeTarget.userId, userId))),
    ])
    const { userId: _userId, externalRequestHash: _hash, externalRequestKey: _key, ...tradeData } = row
    return NextResponse.json({ ...tradeData, events: events.map(({ userId: _eventUserId, ...event }) => event),
      targets: targets.map(({ userId: _targetUserId, ...target }) => target) })
  } catch (cause) { return apiResponseError(cause) }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const id = positiveId((await context.params).id)
    const version = versionFromHeader(req)
    const body = await readJsonObject(req)
    onlyKeys(body, ['notes', 'strategy', 'setupTags'])
    if (Object.keys(body).length === 0) throw new ApiError(400, 'Mindestens ein Feld erforderlich.')
    const values: { notes?: string | null; strategy?: string | null; setupTags?: string | null } = {}
    for (const field of ['notes', 'strategy'] as const) {
      if (!(field in body)) continue
      const value = body[field]
      const max = field === 'notes' ? 8000 : 4000
      if (value !== null && (typeof value !== 'string' || value.length > max)) throw new ApiError(422, `${field} ist ungültig.`)
      values[field] = typeof value === 'string' ? value.trim() || null : null
    }
    if ('setupTags' in body) {
      if (!Array.isArray(body.setupTags) || body.setupTags.some((tag) => typeof tag !== 'string')) {
        throw new ApiError(422, 'Setup-Tags sind ungültig.')
      }
      try { values.setupTags = serializeSetupTags(body.setupTags as string[]) }
      catch (cause) { throw new ApiError(422, cause instanceof Error ? cause.message : 'Setup-Tags sind ungültig.') }
    }
    const [row] = await db.update(trade).set(values)
      .where(and(eq(trade.id, id), eq(trade.userId, userId), eq(trade.version, version), eq(trade.status, 'geplant')))
      .returning()
    if (!row) {
      const [existing] = await db.select({ version: trade.version, status: trade.status }).from(trade)
        .where(and(eq(trade.id, id), eq(trade.userId, userId))).limit(1)
      if (!existing) throw new ApiError(404, 'Trade nicht gefunden.')
      if (existing.version !== version) throw new ApiError(409, 'Trade wurde inzwischen geändert.')
      throw new ApiError(422, 'Nur geplante Trades können über diese Route korrigiert werden.')
    }
    const { userId: _userId, externalRequestHash: _hash, externalRequestKey: _key, ...result } = row
    return NextResponse.json(result)
  } catch (cause) { return apiResponseError(cause) }
}

import { db } from '@/lib/db'
import { trade, tradeEvent, tradeTarget } from '@/lib/db/schema'
import { ApiError, apiResponseError, onlyKeys, positiveId, readJsonObject, requireApiScope, versionFromHeader } from '@/lib/assistant-api'
import { serializeSetupTags } from '@/lib/setups'
import { normalizePlanContext, planGaps, planningSnapshot } from '@/lib/plan-context'
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
    onlyKeys(body, ['notes', 'strategy', 'setupTags', 'planContext', 'elliottInvalidation', 'elliottWaveCount', 'waveDegree', 'source'])
    if (Object.keys(body).length === 0) throw new ApiError(400, 'Mindestens ein Feld erforderlich.')
    const values: Partial<typeof trade.$inferInsert> = {}
    const planChanged = ['planContext', 'elliottInvalidation', 'elliottWaveCount', 'waveDegree'].some(key => key in body)
    let source: { kind: string; capturedAt: string } | null = null
    if (planChanged) {
      const raw = body.source as Record<string, unknown> | undefined
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.kind !== 'user_statement' ||
          raw.confirmedByUser !== true || typeof raw.capturedAt !== 'string' || !Number.isFinite(new Date(raw.capturedAt).getTime())) {
        throw new ApiError(422, 'Planangaben brauchen eine bestätigte Nutzeraussage mit Zeitpunkt.')
      }
      onlyKeys(raw, ['kind', 'capturedAt', 'confirmedByUser'])
      source = { kind: 'user_statement', capturedAt: new Date(raw.capturedAt).toISOString() }
    } else if ('source' in body) throw new ApiError(422, 'Quelle nur zusammen mit Planangaben angeben.')
    if ('planContext' in body) {
      try { values.planContext = normalizePlanContext(body.planContext) }
      catch { throw new ApiError(422, 'Plan-Kontext ist ungültig.') }
    }
    if ('elliottInvalidation' in body) {
      const value = body.elliottInvalidation
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
        throw new ApiError(422, 'Invalidierung ist ungültig.')
      }
      values.elliottInvalidation = value as number | null
    }
    for (const field of ['elliottWaveCount', 'waveDegree'] as const) {
      if (!(field in body)) continue
      const value = body[field]
      if (value !== null && (typeof value !== 'string' || value.length > (field === 'waveDegree' ? 200 : 4000))) {
        throw new ApiError(422, `${field} ist ungültig.`)
      }
      values[field] = typeof value === 'string' ? value.trim() || null : null
    }
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
    const row = await db.transaction(async tx => {
      const owned = and(eq(trade.id, id), eq(trade.userId, userId))
      const [existing] = await tx.select().from(trade).where(owned).for('update').limit(1)
      if (!existing) throw new ApiError(404, 'Trade nicht gefunden.')
      if (existing.version !== version) throw new ApiError(409, 'Trade wurde inzwischen geändert.')
      if (existing.status !== 'geplant') throw new ApiError(422, 'Nur geplante Trades können über diese Route korrigiert werden.')
      if ('elliottInvalidation' in body && body.elliottInvalidation !== existing.elliottInvalidation &&
          !('planContext' in body) && existing.planContext) {
        values.planContext = { ...existing.planContext, riskConfirmed: false }
      }
      if (planChanged) values.preTradeAnswered = planGaps({ ...existing, ...values } as typeof existing).length === 0
      const [saved] = await tx.update(trade).set(values).where(and(owned, eq(trade.version, version))).returning()
      if (!saved) throw new ApiError(409, 'Trade wurde inzwischen geändert.')
      if (planChanged) await tx.insert(tradeEvent).values({ tradeId: id, userId, type: 'notiz',
        note: 'Planangaben ergänzt; vorherige Fassung erhalten',
        payload: JSON.stringify({ source, before: planningSnapshot(existing), after: planningSnapshot(saved) }) })
      return saved
    })
    const { userId: _userId, externalRequestHash: _hash, externalRequestKey: _key, ...result } = row
    return NextResponse.json(result)
  } catch (cause) { return apiResponseError(cause) }
}

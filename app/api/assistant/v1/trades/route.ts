import { db } from '@/lib/db'
import { portfolio, trade } from '@/lib/db/schema'
import { ApiError, apiResponseError, hashToken, positiveId, readJsonObject, requireApiScope } from '@/lib/assistant-api'
import { canonicalBody, normalizeAssistantTradeInput } from '@/lib/assistant-trade-input'
import { createTradeForUser } from '@/lib/create-trade-service'
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:read')
    const params = req.nextUrl.searchParams
    if ([...params.keys()].some((key) => !['portfolioId', 'from', 'to', 'limit', 'cursor'].includes(key))) throw new ApiError(400, 'Unbekannter Filter.')
    const portfolioId = params.get('portfolioId') ? positiveId(params.get('portfolioId')!) : null
    if (portfolioId != null) {
      const [owned] = await db.select({ id: portfolio.id }).from(portfolio)
        .where(and(eq(portfolio.id, portfolioId), eq(portfolio.userId, userId))).limit(1)
      if (!owned) throw new ApiError(404, 'Depot nicht gefunden.')
    }
    const limitRaw = params.get('limit') ?? '50'
    if (!/^[1-9]\d*$/.test(limitRaw) || Number(limitRaw) > 100) throw new ApiError(400, 'limit muss zwischen 1 und 100 liegen.')
    const parseDate = (value: string | null) => {
      if (value == null) return null
      const date = new Date(value)
      if (!Number.isFinite(date.getTime())) throw new ApiError(400, 'Ungültiger Zeitraum.')
      return date
    }
    const from = parseDate(params.get('from'))
    const to = parseDate(params.get('to'))
    if (from && to && from > to) throw new ApiError(400, 'Ungültiger Zeitraum.')
    let cursor: { date: Date; id: number } | null = null
    const raw = params.get('cursor')
    if (raw) {
      try {
        if (raw.length > 200) throw new Error()
        const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
        if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== 'string' ||
            !Number.isSafeInteger(decoded[1]) || decoded[1] <= 0) throw new Error()
        const date = new Date(decoded[0])
        if (!Number.isFinite(date.getTime())) throw new Error()
        cursor = { date, id: decoded[1] }
      } catch { throw new ApiError(400, 'Ungültiger Cursor.') }
    }
    const rows = await db.select({ id: trade.id, portfolioId: trade.portfolioId,
      ticker: trade.ticker, market: trade.market, direction: trade.direction,
      status: trade.status, createdAt: trade.createdAt }).from(trade)
      .where(and(eq(trade.userId, userId),
        portfolioId == null ? undefined : eq(trade.portfolioId, portfolioId),
        from ? gte(trade.createdAt, from) : undefined, to ? lte(trade.createdAt, to) : undefined,
        cursor ? or(lt(trade.createdAt, cursor.date),
          and(eq(trade.createdAt, cursor.date), lt(trade.id, cursor.id))) : undefined))
      .orderBy(desc(trade.createdAt), desc(trade.id)).limit(Number(limitRaw) + 1)
    const page = rows.slice(0, Number(limitRaw))
    const last = page[page.length - 1]
    return NextResponse.json({ items: page, nextCursor: rows.length > page.length && last
      ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString('base64url') : null })
  } catch (cause) { return apiResponseError(cause) }
}

function publicTrade(row: typeof trade.$inferSelect) {
  const { userId: _userId, externalRequestHash: _hash, externalRequestKey: _key, ...result } = row
  return result
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:write')
    const key = req.headers.get('idempotency-key')
    if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      throw new ApiError(400, 'Idempotency-Key als UUID erforderlich.')
    }
    const raw = await readJsonObject(req)
    const { input, source } = normalizeAssistantTradeInput(raw)
    const hash = hashToken(canonicalBody(raw))
    const lookup = async () => {
      const [found] = await db.select().from(trade)
        .where(and(eq(trade.userId, userId), eq(trade.externalRequestKey, key))).limit(1)
      if (!found) return null
      if (found.externalRequestHash !== hash) throw new ApiError(409, 'Idempotenzschlüssel wurde mit anderen Angaben verwendet.')
      return found
    }
    const existing = await lookup()
    if (existing) return NextResponse.json(publicTrade(existing))
    let id: number
    try {
      const created = await createTradeForUser(userId, input, { key, hash, source })
      id = created.id
    } catch (cause) {
      // Ein paralleler POST mit gleichem Schlüssel gewinnt den Unique-Index.
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
        const duplicate = await lookup()
        if (duplicate) return NextResponse.json(publicTrade(duplicate))
      }
      if (cause instanceof Error && !('code' in cause)) throw new ApiError(422, cause.message)
      throw cause
    }
    const [row] = await db.select().from(trade)
      .where(and(eq(trade.id, id), eq(trade.userId, userId))).limit(1)
    if (!row) throw new ApiError(503, 'Trade wurde angelegt, konnte aber nicht zurückgelesen werden. Bitte denselben Idempotenzschlüssel erneut senden.')
    return NextResponse.json(publicTrade(row), { status: 201 })
  } catch (cause) { return apiResponseError(cause) }
}

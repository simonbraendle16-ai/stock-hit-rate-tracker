import { NextRequest, NextResponse } from 'next/server'
import {
  ApiError,
  apiResponseError,
  requireApiScope,
  readJsonObject,
  requestKey,
} from '@/lib/assistant-api'
import { listFib, saveFib } from '@/lib/fibonacci-service'
import {
  filterFib,
  fibStats,
  FIB_WAVES,
  FIB_DEGREES,
  FIB_TIMEFRAMES,
} from '@/lib/fibonacci'
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, 'trades:read'),
      p = req.nextUrl.searchParams
    const allowed = [
      'stockId',
      'market',
      'wave',
      'degree',
      'timeframe',
      'from',
      'to',
      'limit',
      'offset',
    ]
    if ([...p.keys()].some((k) => !allowed.includes(k)))
      throw new ApiError(400, 'Unbekannter Filter.')
    const integer = (
      key: string,
      fallback: number,
      min: number,
      max: number,
    ) => {
      const raw = p.get(key)
      const n = raw === null ? fallback : Number(raw)
      if (
        (raw !== null && !/^\d+$/.test(raw)) ||
        !Number.isSafeInteger(n) ||
        n < min ||
        n > max
      )
        throw new ApiError(400, `Ungültiger Filter: ${key}.`)
      return n
    }
    for (const [key, options] of [
      [
        'market',
        [
          'aktien',
          'krypto',
          'forex',
          'rohstoffe',
          'etf',
          'optionen',
          'sonstiges',
        ],
      ],
      ['wave', FIB_WAVES],
      ['degree', FIB_DEGREES],
      ['timeframe', FIB_TIMEFRAMES],
    ] as const) {
      const value = p.get(key)
      if (value !== null && !(options as readonly string[]).includes(value))
        throw new ApiError(400, `Unbekannter Filterwert: ${key}.`)
    }
    const stockId = p.has('stockId')
      ? integer('stockId', 0, 1, 2147483647)
      : undefined
    const limit = integer('limit', 100, 1, 500),
      offset = integer('offset', 0, 0, 1000000)
    for (const key of ['from', 'to']) {
      const date = p.get(key)
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)) ||
          new Date(date).toISOString().slice(0, 10) !== date)
      )
        throw new ApiError(400, 'Ungültiges Datum.')
    }
    if (p.get('from') && p.get('to') && p.get('from')! > p.get('to')!)
      throw new ApiError(400, 'Zeitraum ist umgekehrt.')
    const items = filterFib(
      await listFib(userId, stockId),
      Object.fromEntries(
        ['market', 'wave', 'degree', 'timeframe', 'from', 'to'].map((k) => [
          k,
          p.get(k) || undefined,
        ]),
      ),
    )
    return NextResponse.json({
      items: items.slice(offset, offset + limit),
      total: items.length,
      nextOffset: offset + limit < items.length ? offset + limit : null,
      stats: fibStats(items),
    })
  } catch (e) {
    return apiResponseError(e)
  }
}
export async function POST(req: NextRequest) {
  try {
    const owner = await requireApiScope(req, 'trades:write')
    return NextResponse.json(
      await saveFib(owner, requestKey(req), await readJsonObject(req)),
      { status: 201 },
    )
  } catch (e) {
    return apiResponseError(e)
  }
}

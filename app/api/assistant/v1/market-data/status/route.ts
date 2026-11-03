import { NextRequest, NextResponse } from 'next/server'
import { requireApiScope, apiResponseError } from '@/lib/assistant-api'
import { marketDb, marketDatabaseStatus } from '@/lib/market-data/database'
import { candleCache, candleSeries } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'
// Authenticated, bounded stored-data reads only. Never calls a market provider.
export async function GET(req: NextRequest) {
  try { await requireApiScope(req, 'trades:read') } catch (error) { return apiResponseError(error) }
  try {
    const series = await marketDb.select({ present: candleSeries.symbol }).from(candleSeries).limit(1)
    const candles = await marketDb.select({ present: candleCache.time }).from(candleCache).limit(1)
    const status = marketDatabaseStatus()
    return NextResponse.json({ ok: true, location: status.location, version: status.version,
      storedSeriesAvailable: series.length > 0, storedCandlesAvailable: candles.length > 0 },
      { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, error: 'Marktdatenspeicher nicht erreichbar.' }, { status: 503 })
  }
}

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stock } from '@/lib/db/schema'
import { Market, MarketDataError } from '@/lib/market-data'
import { getCachedCandles } from '@/lib/market-data/cached'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * Ein Eintrag je Instrument:
 * - ok:       Sparkline-Daten (letzte ~90 Tagesschlusskurse) + Kurs + Tagesänderung
 * - pending:  Twelve-Data-Limit gerade erreicht — Client pollt später erneut
 * - nodata:   Markt/Ticker hat im Gratis-Tier keine Kursdaten (z. B. Optionen)
 * - error:    unerwarteter Fehler
 */
export type SparkEntry =
  | { status: 'ok'; closes: number[]; last: number; changePct: number }
  | { status: 'pending' | 'nodata' | 'error' }

export type SparklinesResponse = { sparks: Record<number, SparkEntry> }

async function fetchSpark(symbol: string, market: Market): Promise<SparkEntry> {
  try {
    const candles = await getCachedCandles(symbol.toUpperCase(), market, '1day')
    const closes = candles.slice(-90).map((c) => c.close)
    if (closes.length < 2) return { status: 'nodata' }
    const last = closes[closes.length - 1]
    const prev = closes[closes.length - 2]
    return { status: 'ok', closes, last, changePct: ((last - prev) / prev) * 100 }
  } catch (err) {
    if (err instanceof MarketDataError) {
      if (err.code === 'rate_limit') return { status: 'pending' }
      if (err.code === 'unknown_symbol' || err.code === 'unsupported') {
        return { status: 'nodata' }
      }
    }
    return { status: 'error' }
  }
}

/**
 * Liefert Sparklines für ALLE Instrumente des Users in einem Request.
 * Kerzen kommen aus demselben 12-h-Cache wie `/api/candles`; nur nicht gecachte
 * Symbole erzeugen Upstream-Requests. Rate-Limit-Treffer werden als `pending`
 * markiert statt den ganzen Batch scheitern zu lassen.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  const stocks = await db
    .select({ id: stock.id, ticker: stock.ticker, market: stock.market })
    .from(stock)
    .where(eq(stock.userId, session.user.id))

  const entries = await Promise.all(
    stocks.map(async (s) => [s.id, await fetchSpark(s.ticker, s.market as Market)] as const),
  )

  const sparks: Record<number, SparkEntry> = {}
  for (const [id, entry] of entries) sparks[id] = entry

  return NextResponse.json({ sparks } satisfies SparklinesResponse)
}

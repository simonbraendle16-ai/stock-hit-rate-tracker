import { auth } from '@/lib/auth'
import { Market, MarketDataError } from '@/lib/market-data'
import { getCachedQuote } from '@/lib/market-data/quote'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const VALID_MARKETS: Market[] = [
  'aktien',
  'krypto',
  'forex',
  'rohstoffe',
  'etf',
  'optionen',
  'sonstiges',
]

/**
 * Aktueller Kurs eines Instruments (letzte Kerze). Gecacht über
 * `getCachedQuote` → `getCachedCandles`, dieselbe 15-Min-Schonung wie der Chart.
 * Die Live-Position im Cockpit ruft das je aktiver Position auf.
 */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const symbol = params.get('symbol')?.trim().toUpperCase() ?? ''
  const market = (params.get('market') ?? 'aktien') as Market

  if (!symbol || symbol.length > 20 || !/^[A-Z0-9./:-]+$/.test(symbol)) {
    return NextResponse.json({ error: 'Ungültiges Symbol.' }, { status: 400 })
  }
  if (!VALID_MARKETS.includes(market)) {
    return NextResponse.json({ error: `Unbekannter Markt „${market}“.` }, { status: 400 })
  }

  try {
    const quote = await getCachedQuote(symbol, market)
    return NextResponse.json({ symbol, market, ...quote })
  } catch (err) {
    if (err instanceof MarketDataError) {
      const status =
        err.code === 'rate_limit' ? 429 : err.code === 'unknown_symbol' ? 404 : 422
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    console.error('quote route:', err)
    return NextResponse.json(
      { error: 'Kurs konnte nicht geladen werden.' },
      { status: 502 },
    )
  }
}

import { auth } from '@/lib/auth'
import { Interval, Market, MarketDataError } from '@/lib/market-data'
import { getCachedCandles } from '@/lib/market-data/cached'
import { createSymbolResolver, lookupProviderSymbol } from '@/lib/market-data/lookup'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

const VALID_INTERVALS: Interval[] = ['15min', '30min', '1h', '4h', '1day', '1week', '1month']
const VALID_MARKETS: Market[] = [
  'aktien',
  'krypto',
  'forex',
  'rohstoffe',
  'etf',
  'optionen',
  'sonstiges',
]

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const symbol = params.get('symbol')?.trim().toUpperCase() ?? ''
  const market = (params.get('market') ?? 'aktien') as Market
  const interval = (params.get('interval') ?? '1day') as Interval
  // Siehe `/api/quote`: über die Verknüpfung, wenn der Aufrufer sie kennt.
  const stockIdRaw = params.get('stockId')
  const stockId = stockIdRaw && /^\d+$/.test(stockIdRaw) ? Number(stockIdRaw) : null

  if (!symbol || symbol.length > 20 || !/^[A-Z0-9./:-]+$/.test(symbol)) {
    return NextResponse.json({ error: 'Ungültiges Symbol.' }, { status: 400 })
  }
  if (!VALID_MARKETS.includes(market)) {
    return NextResponse.json({ error: `Unbekannter Markt „${market}“.` }, { status: 400 })
  }
  if (!VALID_INTERVALS.includes(interval)) {
    return NextResponse.json({ error: `Unbekanntes Intervall „${interval}“.` }, { status: 400 })
  }

  try {
    // Der Aufrufer schickt den Ticker, wie er in der Watchlist steht (`CL1!`).
    // Beim Anbieter heißt derselbe Wert anders (`CL=F`) — die Übersetzung
    // passiert zentral in `lookupProviderSymbol`, nie hier von Hand.
    const providerSymbol = stockId
      ? (await createSymbolResolver(session.user.id))(symbol, stockId)
      : (await lookupProviderSymbol(session.user.id, symbol)).symbol
    const candles = await getCachedCandles(providerSymbol, market, interval)
    return NextResponse.json({
      symbol,
      providerSymbol,
      market,
      interval,
      candles,
    })
  } catch (err) {
    if (err instanceof MarketDataError) {
      const status =
        err.code === 'rate_limit' ? 429 : err.code === 'unknown_symbol' ? 404 : 422
      return NextResponse.json({ error: err.message, code: err.code }, { status })
    }
    console.error('candles route:', err)
    return NextResponse.json(
      { error: 'Kursdaten konnten nicht geladen werden.' },
      { status: 502 },
    )
  }
}

import { auth } from '@/lib/auth'
import { Market, MarketDataError } from '@/lib/market-data'
import { createSymbolResolver, lookupProviderSymbol } from '@/lib/market-data/lookup'
import { getCachedQuote } from '@/lib/market-data/quote'
import {
  istGueltigerTicker,
  istGueltigesAnbieterSymbol,
  unaufgeloestMeldung,
} from '@/lib/market-data/symbol-syntax'
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
  // Ein TRADE trägt seinen eigenen Ticker (`SOL`), das verknüpfte Instrument
  // einen anderen (`SOLUSD`) — aufzulösen ist er nur über die Verknüpfung.
  const stockIdRaw = params.get('stockId')
  const stockId = stockIdRaw && /^\d+$/.test(stockIdRaw) ? Number(stockIdRaw) : null

  // Der ROHE Ticker wird großzügig geprüft — er ist nur eine Absicht und wird
  // gleich übersetzt. Das enge Muster gilt erst für das, was rausgeht (unten).
  // Vorher stand hier eines für beides, und es kannte weder `=` noch `^`: Damit
  // war in dieser Route jeder Terminkontrakt und jeder Index tot, und ein Trade
  // mit dem Ticker `CL1!` oder `THE TRADE DESK` bekam „Ungültiges Symbol.",
  // obwohl seine Auflösung längst korrekt in der Datenbank stand.
  if (!istGueltigerTicker(symbol)) {
    return NextResponse.json({ error: 'Ungültiges Symbol.' }, { status: 400 })
  }
  if (!VALID_MARKETS.includes(market)) {
    return NextResponse.json({ error: `Unbekannter Markt „${market}“.` }, { status: 400 })
  }

  try {
    // Ticker der Watchlist → Anbieter-Symbol, zentral (siehe `lookup.ts`).
    const providerSymbol = stockId
      ? (await createSymbolResolver(session.user.id))(symbol, stockId)
      : (await lookupProviderSymbol(session.user.id, symbol)).symbol
    // Hier fällt die Entscheidung, ob wirklich gefragt wird. Der Rückfall auf
    // den Rohticker ist Absicht — abgefragt werden darf er trotzdem nicht:
    // Yahoo kennt ein anderes Papier namens `BTC`, und ein stiller falscher
    // Kurs ist genau das, wogegen diese App gebaut ist.
    if (!istGueltigesAnbieterSymbol(providerSymbol)) {
      return NextResponse.json(
        { error: unaufgeloestMeldung(symbol), code: 'unresolved' },
        { status: 422 },
      )
    }
    const quote = await getCachedQuote(providerSymbol, market)
    return NextResponse.json({ symbol, providerSymbol, market, ...quote })
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

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trainingSession } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { Interval, Market, MarketDataError } from '@/lib/market-data'
import { getCachedCandles } from '@/lib/market-data/cached'
import { createSymbolResolver, lookupProviderSymbol } from '@/lib/market-data/lookup'
import { intervalForTimeframe } from '@/lib/chart-timeframes'
import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Kerzen für eine Trainingseinheit. Bewusst deutlich mehr als für einen
 * normalen Chart: Der Replay braucht Vergangenheit UND verborgene Zukunft,
 * und beides kommt aus demselben Satz.
 */
const TRAINING_CANDLE_LIMIT = 3000

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
  let symbol = params.get('symbol')?.trim().toUpperCase() ?? ''
  let market = (params.get('market') ?? 'aktien') as Market
  let interval = (params.get('interval') ?? '1day') as Interval
  // Siehe `/api/quote`: über die Verknüpfung, wenn der Aufrufer sie kennt.
  const stockIdRaw = params.get('stockId')
  let stockId = stockIdRaw && /^\d+$/.test(stockIdRaw) ? Number(stockIdRaw) : null

  // Verdeckte Trainingseinheit (Replay-Trainer): Der Browser kennt das Symbol
  // NICHT und darf es auch nicht erfahren — sonst wäre „verdeckt" nur ein
  // Anzeige-Trick, und die erste Netzwerkzeile verriete das Instrument. Deshalb
  // fragt der Chart hier mit der Übungs-Nummer an; Symbol, Markt und Intervall
  // holt der Server aus der Übung und gibt sie erst nach dem Aufdecken zurück.
  const trainingRaw = params.get('trainingSessionId')
  const trainingSessionId = trainingRaw && /^\d+$/.test(trainingRaw) ? Number(trainingRaw) : null
  let verdeckt = false

  if (trainingSessionId != null) {
    const [row] = await db
      .select()
      .from(trainingSession)
      .where(
        and(
          eq(trainingSession.id, trainingSessionId),
          eq(trainingSession.userId, session.user.id),
        ),
      )
    if (!row) {
      return NextResponse.json({ error: 'Trainingseinheit nicht gefunden.' }, { status: 404 })
    }
    symbol = row.symbol.toUpperCase()
    market = row.market as Market
    interval = intervalForTimeframe(row.timeframe)
    stockId = row.stockId ?? null
    verdeckt = row.blind && row.revealedAt == null
  }

  if (!symbol || symbol.length > 20 || !/^[A-Z0-9./:^=-]+$/.test(symbol)) {
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
    // Eine Übung lebt von Historie: Vergangenheit zum Analysieren UND Zukunft
    // zum Aufdecken. Deshalb bekommt der Trainer mehr Kerzen als ein normaler
    // Chart, in dem die letzten paar hundert genügen.
    const limit = trainingSessionId != null ? TRAINING_CANDLE_LIMIT : undefined
    const candles = await getCachedCandles(providerSymbol, market, interval, { limit })
    return NextResponse.json({
      // Bei einer verdeckten Übung bleibt beides leer — der Chart beschriftet
      // sich dann selbst mit „Verdecktes Instrument".
      symbol: verdeckt ? null : symbol,
      providerSymbol: verdeckt ? null : providerSymbol,
      market: verdeckt ? null : market,
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

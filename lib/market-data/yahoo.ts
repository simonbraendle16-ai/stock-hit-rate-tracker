// Yahoo-Finance-Anbindung — die Primärquelle für Kurse, Kerzen und Symbolsuche.
//
// Warum Yahoo und nicht Twelve Data (bisherige Primärquelle):
// Das Gratis-Tier von Twelve Data erlaubt 8 Requests/Minute und deckt weder
// Futures (CL1!) noch Indizes noch die Heimatbörsen XETRA/Euronext/HKEX ab. Eine
// Watchlist mit ~90 Instrumenten ist damit strukturell nicht bedienbar — die
// meisten Symbole liefen ins Rate-Limit statt in einen Kurs. Yahoo liefert
// dieselben Instrumente kostenlos, ohne Key und vor allem GEBÜNDELT: alle
// Symbole in einem Request statt in 90.
//
// Ehrlichkeitsgebot: Yahoo ist eine inoffizielle Schnittstelle ohne
// Verfügbarkeitszusage. Deshalb ist sie hier nur EINE Quelle hinter dem
// gemeinsamen `MarketDataProvider`-Vertrag; `resolveProvider` fällt bei Ausfall
// auf Twelve Data bzw. Binance zurück, und Kurse werden zusätzlich in der
// Datenbank gehalten (siehe `quoteCache`), damit ein Ausfall den letzten
// bekannten Kurs zeigt statt ein leeres Feld.

import {
  Candle,
  DEFAULT_OUTPUT_SIZE,
  Interval,
  MarketDataError,
  MarketDataProvider,
} from './types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

/**
 * Yahoo kennt kein 4h-Intervall. Wir holen 60m und aggregieren daraus — der
 * Rest bildet 1:1 ab.
 */
const YAHOO_INTERVAL: Record<Interval, string> = {
  '15min': '15m',
  '30min': '30m',
  '1h': '60m',
  '4h': '60m',
  '1day': '1d',
  '1week': '1wk',
  '1month': '1mo',
}

/**
 * Zeitraum je Intervall, großzügig genug für `DEFAULT_OUTPUT_SIZE` Kerzen.
 * Yahoo akzeptiert nur diese festen Bezeichner, keine freien Zahlen.
 */
const YAHOO_RANGE: Record<Interval, string> = {
  '15min': '1mo',
  '30min': '1mo',
  '1h': '3mo',
  '4h': '1y',
  '1day': '5y',
  '1week': '10y',
  '1month': 'max',
}

// --- Crumb-Verwaltung ------------------------------------------------------
// Der Batch-Quote-Endpunkt (v7) verlangt seit einiger Zeit ein Cookie plus
// einen daraus abgeleiteten „Crumb". Beides ist anonym, hält aber nicht ewig;
// wir cachen es prozessweit und holen es bei 401/403 genau einmal neu.

interface Credentials {
  cookie: string
  crumb: string
  fetchedAt: number
}

let credentials: Credentials | null = null
let credentialsInFlight: Promise<Credentials> | null = null

const CREDENTIALS_TTL_MS = 1000 * 60 * 60 * 6

async function fetchCredentials(): Promise<Credentials> {
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    cache: 'no-store',
  }).catch(() => null)

  // fc.yahoo.com antwortet absichtlich mit einem Fehlerstatus, setzt dabei aber
  // das benötigte Cookie — der Status ist hier also kein Fehlersignal.
  const cookie = (cookieRes?.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')

  if (!cookie) {
    throw new MarketDataError('Yahoo lieferte kein Sitzungs-Cookie.', 'upstream')
  }

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, cookie },
    cache: 'no-store',
  })
  const crumb = (await crumbRes.text()).trim()

  if (!crumbRes.ok || !crumb || crumb.includes('<')) {
    throw new MarketDataError('Yahoo lieferte keinen gültigen Crumb.', 'upstream')
  }

  return { cookie, crumb, fetchedAt: Date.now() }
}

/** Cookie + Crumb, prozessweit gecacht. `force` erzwingt eine Neubeschaffung. */
async function getCredentials(force = false): Promise<Credentials> {
  if (force) {
    credentials = null
    credentialsInFlight = null
  }
  if (credentials && Date.now() - credentials.fetchedAt < CREDENTIALS_TTL_MS) {
    return credentials
  }
  // Parallele Aufrufe teilen sich EINE Beschaffung — sonst holen 90 Symbole
  // gleichzeitig 90 Crumbs.
  credentialsInFlight ??= fetchCredentials()
    .then((c) => {
      credentials = c
      return c
    })
    .finally(() => {
      credentialsInFlight = null
    })
  return credentialsInFlight
}

// --- Kerzen ----------------------------------------------------------------

interface ChartResult {
  meta?: {
    symbol?: string
    currency?: string
    exchangeName?: string
    fullExchangeName?: string
    longName?: string
    shortName?: string
    instrumentType?: string
    regularMarketPrice?: number
    chartPreviousClose?: number
    previousClose?: number
    regularMarketTime?: number
  }
  timestamp?: number[]
  indicators?: {
    quote?: Array<{
      open?: (number | null)[]
      high?: (number | null)[]
      low?: (number | null)[]
      close?: (number | null)[]
      volume?: (number | null)[]
    }>
  }
}

async function fetchChart(symbol: string, interval: Interval): Promise<ChartResult> {
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  )
  url.searchParams.set('interval', YAHOO_INTERVAL[interval])
  url.searchParams.set('range', YAHOO_RANGE[interval])

  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  } catch (err) {
    throw new MarketDataError(
      `Yahoo ist nicht erreichbar (${err instanceof Error ? err.message : 'Netzfehler'}).`,
      'upstream',
    )
  }

  if (res.status === 404) {
    throw new MarketDataError(`Unbekanntes Symbol „${symbol}“ bei Yahoo.`, 'unknown_symbol')
  }
  if (res.status === 429) {
    throw new MarketDataError('Yahoo-Rate-Limit erreicht — bitte kurz warten.', 'rate_limit')
  }
  if (!res.ok) {
    throw new MarketDataError(`Yahoo antwortet mit Status ${res.status}.`, 'upstream')
  }

  const body = (await res.json()) as {
    chart?: { result?: ChartResult[] | null; error?: { code?: string; description?: string } | null }
  }

  const error = body.chart?.error
  if (error) {
    const notFound = error.code === 'Not Found' || /not found|no data/i.test(error.description ?? '')
    throw new MarketDataError(
      error.description ?? `Yahoo lieferte keine Daten für „${symbol}“.`,
      notFound ? 'unknown_symbol' : 'upstream',
    )
  }

  const result = body.chart?.result?.[0]
  if (!result) {
    throw new MarketDataError(`Keine Kursdaten für „${symbol}“ gefunden.`, 'unknown_symbol')
  }
  return result
}

/** Wandelt Yahoos spaltenweise Struktur in unsere Kerzen; Lücken fallen raus. */
function toCandles(result: ChartResult): Candle[] {
  const stamps = result.timestamp ?? []
  const q = result.indicators?.quote?.[0]
  if (!q) return []

  const candles: Candle[] = []
  for (let i = 0; i < stamps.length; i++) {
    const close = q.close?.[i]
    const open = q.open?.[i]
    const high = q.high?.[i]
    const low = q.low?.[i]
    // Yahoo füllt handelsfreie Slots mit null — die überspringen wir, statt sie
    // als 0-Kerzen in den Chart zu schreiben.
    if (close == null || open == null || high == null || low == null) continue
    candles.push({
      time: stamps[i],
      open,
      high,
      low,
      close,
      volume: q.volume?.[i] ?? 0,
    })
  }
  return candles
}

/** Fasst 60m-Kerzen zu 4h-Kerzen zusammen (Yahoo kennt kein 4h). */
function aggregateTo4h(candles: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>()
  const FOUR_HOURS = 4 * 60 * 60
  for (const c of candles) {
    const key = Math.floor(c.time / FOUR_HOURS) * FOUR_HOURS
    const existing = buckets.get(key)
    if (!existing) {
      buckets.set(key, { ...c, time: key })
      continue
    }
    existing.high = Math.max(existing.high, c.high)
    existing.low = Math.min(existing.low, c.low)
    existing.close = c.close
    existing.volume += c.volume
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time)
}

export const yahooProvider: MarketDataProvider = {
  async getCandles(symbol: string, interval: Interval): Promise<Candle[]> {
    const result = await fetchChart(symbol, interval)
    let candles = toCandles(result)
    if (interval === '4h') candles = aggregateTo4h(candles)
    if (candles.length === 0) {
      throw new MarketDataError(`Keine Kursdaten für „${symbol}“ gefunden.`, 'unknown_symbol')
    }
    return candles.slice(-DEFAULT_OUTPUT_SIZE[interval])
  },
}

// --- Batch-Kurse -----------------------------------------------------------

export interface YahooQuote {
  symbol: string
  price: number
  previousClose: number | null
  changePct: number | null
  /** Währung, in der DIESE Notierung handelt. */
  currency: string | null
  /**
   * Währung, in der das Unternehmen bilanziert — also seine Heimatwährung.
   *
   * Das ist der Schlüssel zur Frage „welcher Handelsplatz?": SAP handelt an der
   * NYSE in USD und an XETRA in EUR, bilanziert aber in EUR. Die Notierung,
   * deren Handelswährung der Bilanzwährung entspricht, IST die Heimatbörse.
   * Über das Handelsvolumen allein ginge das schief — die US-Hinterlegung von
   * SAP und ASML wird reger gehandelt als das Original.
   */
  financialCurrency: string | null
  exchange: string | null
  name: string | null
  /** Unix-Sekunden des Kursstands. */
  time: number
  /** Ob der Markt gerade handelt — für die „Kurs von …"-Beschriftung. */
  marketState: string | null
  /**
   * EQUITY | ETF | INDEX | FUTURE | CRYPTOCURRENCY | CURRENCY | MUTUALFUND.
   *
   * Kommt bewusst aus der Kursantwort und nicht nur aus der Suche: Sonst hätten
   * Kandidaten aus der Suche eine Angabe und Kandidaten aus der Suffix-Regel
   * nicht — und dieselbe Aktie bekäme je nach Herkunft verschiedene Punktzahlen.
   */
  quoteType: string | null
  /**
   * Tagesvolumen. Wird für die Auswahl des Handelsplatzes gebraucht: Ein Wert
   * ist oft an einem halben Dutzend Börsen notiert, und die Heimatbörse ist
   * praktisch immer die mit dem weitaus höchsten Umsatz. Das ist ein echter
   * Messwert statt einer gepflegten Länderliste — und er kommt in derselben
   * Antwort mit, kostet also keine zusätzliche Abfrage.
   */
  volume: number | null
}

interface RawQuote {
  symbol?: string
  regularMarketPrice?: number
  regularMarketPreviousClose?: number
  regularMarketChangePercent?: number
  regularMarketTime?: number
  regularMarketVolume?: number
  averageDailyVolume3Month?: number
  currency?: string
  financialCurrency?: string
  fullExchangeName?: string
  exchange?: string
  longName?: string
  shortName?: string
  marketState?: string
  quoteType?: string
}

function mapQuote(r: RawQuote): YahooQuote | null {
  if (!r.symbol || typeof r.regularMarketPrice !== 'number') return null
  const previousClose =
    typeof r.regularMarketPreviousClose === 'number' ? r.regularMarketPreviousClose : null
  const changePct =
    typeof r.regularMarketChangePercent === 'number'
      ? r.regularMarketChangePercent
      : previousClose
        ? ((r.regularMarketPrice - previousClose) / previousClose) * 100
        : null
  return {
    symbol: r.symbol,
    price: r.regularMarketPrice,
    previousClose,
    changePct,
    currency: r.currency ?? null,
    financialCurrency: r.financialCurrency ?? null,
    exchange: r.fullExchangeName ?? r.exchange ?? null,
    name: r.longName ?? r.shortName ?? null,
    time: r.regularMarketTime ?? Math.floor(Date.now() / 1000),
    marketState: r.marketState ?? null,
    quoteType: r.quoteType ?? null,
    // Der Durchschnitt ist die verlässlichere Größe: das Tagesvolumen ist bei
    // geschlossener Börse oder kurz nach Handelsbeginn noch klein und würde die
    // Heimatbörse fälschlich schlecht aussehen lassen.
    volume: r.averageDailyVolume3Month ?? r.regularMarketVolume ?? null,
  }
}

/** Yahoo verträgt lange Symbollisten nicht beliebig — in Blöcken abfragen. */
const QUOTE_CHUNK = 40

async function fetchQuoteChunk(symbols: string[], retry = true): Promise<RawQuote[]> {
  const { cookie, crumb } = await getCredentials()
  const url = new URL('https://query1.finance.yahoo.com/v7/finance/quote')
  url.searchParams.set('symbols', symbols.join(','))
  url.searchParams.set('crumb', crumb)

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, cookie },
    cache: 'no-store',
  })

  if ((res.status === 401 || res.status === 403) && retry) {
    // Crumb abgelaufen — genau einmal neu holen und wiederholen.
    await getCredentials(true)
    return fetchQuoteChunk(symbols, false)
  }
  if (res.status === 429) {
    throw new MarketDataError('Yahoo-Rate-Limit erreicht — bitte kurz warten.', 'rate_limit')
  }
  if (!res.ok) {
    throw new MarketDataError(`Yahoo antwortet mit Status ${res.status}.`, 'upstream')
  }

  const body = (await res.json()) as {
    quoteResponse?: { result?: RawQuote[] | null; error?: unknown }
  }
  return body.quoteResponse?.result ?? []
}

/**
 * Kurse für viele Symbole in möglichst wenigen Requests. Symbole, die Yahoo
 * nicht kennt, fehlen im Ergebnis — der Aufrufer erkennt sie an der Lücke und
 * kann sie als „nicht auflösbar" markieren, statt still eine Null anzuzeigen.
 */
export async function getYahooQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const unique = Array.from(new Set(symbols.filter(Boolean)))
  const out = new Map<string, YahooQuote>()
  if (unique.length === 0) return out

  for (let i = 0; i < unique.length; i += QUOTE_CHUNK) {
    const chunk = unique.slice(i, i + QUOTE_CHUNK)
    const raw = await fetchQuoteChunk(chunk)
    for (const r of raw) {
      const q = mapQuote(r)
      if (q) out.set(q.symbol.toUpperCase(), q)
    }
  }
  return out
}

/**
 * Einzelkurs über den Chart-Endpunkt — der braucht keinen Crumb und ist damit
 * der robustere Weg, wenn die Batch-Abfrage klemmt.
 */
export async function getYahooQuoteViaChart(symbol: string): Promise<YahooQuote> {
  const result = await fetchChart(symbol, '1day')
  const meta = result.meta ?? {}
  const candles = toCandles(result)
  const last = candles[candles.length - 1]
  const price = meta.regularMarketPrice ?? last?.close
  if (typeof price !== 'number') {
    throw new MarketDataError(`Keine Kursdaten für „${symbol}“ gefunden.`, 'unknown_symbol')
  }
  const previousClose =
    meta.chartPreviousClose ??
    meta.previousClose ??
    (candles.length >= 2 ? candles[candles.length - 2].close : null)
  return {
    symbol: meta.symbol ?? symbol,
    price,
    previousClose: previousClose ?? null,
    changePct: previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    currency: meta.currency ?? null,
    financialCurrency: null,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? null,
    name: meta.longName ?? meta.shortName ?? null,
    time: meta.regularMarketTime ?? last?.time ?? Math.floor(Date.now() / 1000),
    marketState: null,
    quoteType: meta.instrumentType ?? null,
    volume: last?.volume ?? null,
  }
}

// --- Suche -----------------------------------------------------------------

export interface YahooSearchHit {
  symbol: string
  name: string
  /** EQUITY | ETF | INDEX | FUTURE | CRYPTOCURRENCY | CURRENCY | MUTUALFUND */
  quoteType: string
  /** Kürzel der Börse, z. B. GER, PAR, NYQ, NMS. */
  exchange: string
  exchangeName: string
}

interface RawSearchHit {
  symbol?: string
  shortname?: string
  longname?: string
  quoteType?: string
  exchange?: string
  exchDisp?: string
  isYahooFinance?: boolean
}

/**
 * Symbolsuche. Trägt sowohl die automatische Auflösung als auch die manuelle
 * Auswahl in der Oberfläche.
 */
export async function searchYahoo(query: string, limit = 10): Promise<YahooSearchHit[]> {
  const q = query.trim()
  if (!q) return []

  const url = new URL('https://query1.finance.yahoo.com/v1/finance/search')
  url.searchParams.set('q', q)
  url.searchParams.set('quotesCount', String(limit))
  url.searchParams.set('newsCount', '0')

  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' })
  } catch (err) {
    throw new MarketDataError(
      `Yahoo-Suche nicht erreichbar (${err instanceof Error ? err.message : 'Netzfehler'}).`,
      'upstream',
    )
  }

  if (res.status === 429) {
    throw new MarketDataError('Yahoo-Rate-Limit erreicht — bitte kurz warten.', 'rate_limit')
  }
  if (!res.ok) {
    throw new MarketDataError(`Yahoo-Suche antwortet mit Status ${res.status}.`, 'upstream')
  }

  const body = (await res.json()) as { quotes?: RawSearchHit[] }
  return (body.quotes ?? [])
    .filter((h): h is RawSearchHit & { symbol: string } => !!h.symbol && h.isYahooFinance !== false)
    .map((h) => ({
      symbol: h.symbol,
      name: h.longname ?? h.shortname ?? h.symbol,
      quoteType: h.quoteType ?? 'EQUITY',
      exchange: h.exchange ?? '',
      exchangeName: h.exchDisp ?? h.exchange ?? '',
    }))
}

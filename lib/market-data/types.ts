// Gemeinsame Typen für die Marktdaten-Provider (Twelve Data + Binance).

export interface Candle {
  /** Unix-Sekunden (UTC) des Kerzenbeginns */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Interval = '15min' | '30min' | '1h' | '4h' | '1day' | '1week' | '1month'

export type Market =
  | 'aktien'
  | 'krypto'
  | 'forex'
  | 'rohstoffe'
  | 'etf'
  | 'optionen'
  | 'sonstiges'

/** Anzahl Kerzen, die pro Interval geladen werden (deckt 1T–mehrere Jahre ab). */
export const DEFAULT_OUTPUT_SIZE: Record<Interval, number> = {
  '15min': 500,
  '30min': 500,
  '1h': 500,
  '4h': 500,
  '1day': 500,
  '1week': 400,
  '1month': 240,
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    /** 'rate_limit' | 'unknown_symbol' | 'unsupported' | 'upstream' */
    public readonly code: 'rate_limit' | 'unknown_symbol' | 'unsupported' | 'upstream',
  ) {
    super(message)
    this.name = 'MarketDataError'
  }
}

export interface MarketDataProvider {
  getCandles(symbol: string, interval: Interval): Promise<Candle[]>
}

/**
 * Eine Watchlist-Zeile mit Auflösungszustand und letztem bekannten Kurs.
 *
 * Liegt hier und nicht bei der Serveraktion, die sie liefert: Eine Datei mit
 * `'use server'` darf ausschließlich async Funktionen exportieren — jeder andere
 * Export, auch ein reiner Typ, lässt den Build mit „A 'use server' file can only
 * export async functions" scheitern.
 */
export interface WatchlistQuote {
  stockId: number
  /** ok | ambiguous | unresolved | null (noch nie versucht) */
  status: string | null
  /** Das Anbieter-Symbol, das tatsächlich abgefragt wird. */
  providerSymbol: string | null
  resolvedName: string | null
  resolvedExchange: string | null
  resolutionNote: string | null
  /** Näherung statt Entsprechung (z. B. Gold-Future statt Spot). */
  approximate: boolean
  /** Von Hand festgelegt — die Automatik fasst es nicht mehr an. */
  pinned: boolean
  price: number | null
  changePct: number | null
  currency: string | null
  /** Unix-Sekunden des Kursstands beim Anbieter. */
  quotedAt: number | null
  /** Wann wir den Kurs geholt haben (ISO) — Grundlage für „Stand von …". */
  fetchedAt: string | null
  /** Wie oft die Aktualisierung zuletzt in Folge misslang. */
  failCount: number
}

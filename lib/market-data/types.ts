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

export type Interval = '1h' | '4h' | '1day' | '1week' | '1month'

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

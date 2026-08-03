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

/**
 * Anzahl Kerzen, die pro Intervall beim Anbieter angefragt werden.
 *
 * Gilt für Anbieter, die eine Stückzahl erwarten (Twelve Data, Binance). Yahoo
 * bekommt stattdessen einen Zeitraum und liefert, was er hat — dort wird
 * bewusst NICHT mehr gekürzt: Was einmal geholt ist, gehört in den
 * Kerzenspeicher, auch wenn der Chart es gerade nicht zeigt.
 */
export const DEFAULT_OUTPUT_SIZE: Record<Interval, number> = {
  '15min': 5000,
  '30min': 3000,
  '1h': 5000,
  '4h': 3000,
  '1day': 2500,
  '1week': 1200,
  '1month': 400,
}

/**
 * Wie viele Kerzen standardmäßig AUSGELIEFERT werden — die Trennung von
 * `DEFAULT_OUTPUT_SIZE` ist Absicht.
 *
 * Der Speicher soll alles behalten, was ein Anbieter je hergegeben hat; ein
 * Chart soll deshalb aber nicht jedes Mal Tausende Kerzen durch die Leitung
 * schicken. Wer mehr braucht (der Replay-Trainer), fragt ausdrücklich mit einem
 * höheren `limit` an.
 */
export const DELIVERY_LIMIT: Record<Interval, number> = {
  '15min': 900,
  '30min': 900,
  '1h': 900,
  '4h': 900,
  '1day': 900,
  '1week': 600,
  '1month': 300,
}

/** Obergrenze für ein ausdrücklich angefragtes `limit` — schützt vor Unsinn. */
export const MAX_DELIVERY_LIMIT = 8000

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

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

export type Interval =
  | '1min'
  | '5min'
  | '15min'
  | '30min'
  | '1h'
  | '4h'
  | '1day'
  | '1week'
  | '1month'

export type Market =
  | 'aktien'
  | 'krypto'
  | 'forex'
  | 'rohstoffe'
  | 'etf'
  | 'optionen'
  | 'sonstiges'

/**
 * Yahoos `quoteType` → Markt der App.
 *
 * Gebraucht, seit die Watchlist Instrumente direkt aus der Symbolsuche anlegt:
 * Der Markt steuert Kerzenintervalle, Alarmregeln und die Auflösung, darf also
 * nicht pauschal auf „aktien“ fallen. Unbekannte Typen landen bewusst auf
 * `sonstiges` statt auf einer plausiblen Vermutung.
 */
export const QUOTE_TYPE_MARKET: Record<string, Market> = {
  EQUITY: 'aktien',
  ETF: 'etf',
  // Ein Investmentfonds ist KEIN ETF — er wird nicht börslich gehandelt und hat
  // keinen fortlaufenden Kurs. Ihn unter „ETF" zu führen wäre genau der stille
  // Falschwert, den die App vermeiden soll.
  MUTUALFUND: 'sonstiges',
  CRYPTOCURRENCY: 'krypto',
  CURRENCY: 'forex',
  FUTURE: 'rohstoffe',
  OPTION: 'optionen',
  INDEX: 'sonstiges',
}

/**
 * Anzahl Kerzen, die pro Intervall beim Anbieter angefragt werden.
 *
 * Gilt für Anbieter, die eine Stückzahl erwarten (Twelve Data, Binance). Yahoo
 * bekommt stattdessen einen Zeitraum und liefert, was er hat — dort wird
 * bewusst NICHT mehr gekürzt: Was einmal geholt ist, gehört in den
 * Kerzenspeicher, auch wenn der Chart es gerade nicht zeigt.
 */
export const DEFAULT_OUTPUT_SIZE: Record<Interval, number> = {
  '1min': 1500,
  '5min': 2000,
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
  '1min': 300,
  '5min': 300,
  '15min': 300,
  '30min': 300,
  '1h': 300,
  '4h': 300,
  '1day': 300,
  // W und M bleiben, wo sie sind: Ihre Zeitebenen haben in
  // `lib/chart-timeframes.ts` `days: null` und zeigen die VOLLE Historie statt
  // eines Fensters (1week reicht bis 1996 zurück). 300 würde dort sichtbar
  // Historie abschneiden — und beide sind am Übertragungsvolumen kaum beteiligt.
  '1week': 600,
  '1month': 300,
}

/** Obergrenze für ein ausdrücklich angefragtes `limit` — schützt vor Unsinn. */
export const MAX_DELIVERY_LIMIT = 8000

/**
 * Wie stark ein Instrument benutzt wird — und damit, wie viel Historie es
 * verdient.
 *
 * Gemessen am 20.08.2026: Bei einer einheitlichen Staffel für alle fasst der
 * Kerzenspeicher voll ausgereizt 586 MB, der Gratistarif gibt 500 MB für die
 * GESAMTE Datenbank her. Eine Grenze für alle löst das nicht — sie kostet
 * entweder den Speicher oder die Trainingstiefe dort, wo tatsächlich geübt wird.
 *
 * Deshalb entscheidet die Nutzung. Von 149 Instrumenten hatten 25 einen offenen
 * Trade, 75 eine Prognose oder einen alten Trade, und **49 gar nichts** — diese
 * 49 hielten allein 576.074 Kerzen, rund 107 MB. Für ein Instrument, das
 * niemand ansieht, sind Minutenkerzen kein Wert, sondern Ballast.
 */
export type SammelStufe = 'A' | 'B' | 'C'

/**
 * Wie viele Kerzen je Reihe AUFBEWAHRT werden — die Grenze gegen das
 * 500-MB-Speicherlimit des Gratistarifs.
 *
 * **Untergrenze bleibt `TRAINING_CANDLE_LIMIT` (3.000) aus
 * `app/api/candles/route.ts`** für jede Ebene, auf der tatsächlich geübt wird.
 * Genau daran hängt die 5.000 bei `1h` in den Stufen A und B: Die bisherigen
 * Trainer-Sitzungen laufen alle auf dieser Ebene und fordern 3.000 Kerzen plus
 * 800 Vorlauf an. Läge die Grenze darunter, holte der Sammellauf Kerzen, die
 * das Aufräumen sofort wieder wegschnitte — ein Schreib-Karussell ohne Nutzen.
 *
 * Die Staffel richtet sich weiter danach, was der Anbieter NACHLIEFERN kann:
 * Was bei `1min` (Yahoo: 7 Tage) oder `15min` (60 Tage) gelöscht wird, ist
 * unwiederbringlich weg; `1day` liefert Yahoo jahrzehntelang auf Zuruf.
 * `1week`/`1month` stehen als Deckel da, nicht als Schnitt — 1.500 Wochenkerzen
 * sind 29 Jahre. Sie bleiben deshalb in ALLEN Stufen ungekürzt.
 *
 * `null` heißt: Diese Ebene wird für diese Stufe gar nicht erst gesammelt.
 */
const RETENTION: Record<SammelStufe, Record<Interval, number | null>> = {
  // Offener Trade — hier wird gehandelt und geübt, hier liegt die volle Tiefe.
  A: {
    '1min': 1500,
    '5min': 2000,
    '15min': 2500,
    '30min': 1200,
    '1h': 5000,
    '4h': 1500,
    '1day': 2000,
    '1week': 1500,
    '1month': 600,
  },
  // Prognose oder abgeschlossener Trade — Kontext ja, Minutenkerzen nein.
  B: {
    '1min': null,
    '5min': null,
    '15min': 2500,
    '30min': 1200,
    '1h': 5000,
    '4h': 1500,
    '1day': 2000,
    '1week': 1500,
    '1month': 600,
  },
  // Ungenutzt — nur so viel, dass das Instrument beim Aufschlagen sofort
  // einen brauchbaren Chart zeigt. Steigt es auf, füllt der Sammellauf nach.
  C: {
    '1min': null,
    '5min': null,
    '15min': null,
    '30min': null,
    '1h': 1500,
    '4h': 1500,
    '1day': 2000,
    '1week': 1500,
    '1month': 600,
  },
}

/**
 * Die Aufbewahrungsgrenze für eine Reihe. `null` heißt „diese Ebene gehört
 * dieser Stufe nicht".
 *
 * Ohne bekannte Stufe gilt **A**, also die großzügigste: Wer die Stufe nicht
 * kennt, darf nicht löschen. Ein zu voller Speicher ist ein Ärgernis, gelöschte
 * Minutenkerzen sind unwiederbringlich.
 */
export function retentionLimit(interval: Interval, stufe: SammelStufe = 'A'): number | null {
  return RETENTION[stufe][interval]
}

/** Die Zeitebenen, die für eine Stufe überhaupt gesammelt werden. */
export function intervalsForStufe(stufe: SammelStufe): Interval[] {
  return (Object.keys(RETENTION[stufe]) as Interval[]).filter(
    (i) => RETENTION[stufe][i] !== null,
  )
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

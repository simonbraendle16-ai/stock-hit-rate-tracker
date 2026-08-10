// Übersetzung Ticker → TradingView-Symbol für das Advanced-Chart-Embed.
//
// Warum es diese Datei gibt: Das Widget bekam bisher den Rohticker. Ohne
// Börsenpräfix rät TradingView — und rät bei mehrdeutigen Kürzeln falsch.
// Nachgeprüft an TradingViews eigener Symbolsuche: `CL1!` gibt es zweimal,
// als `NYMEX:CL1!` (Crude Oil Futures) und als `ASX24:CL1!` (ASX Large
// Generation Certificate Futures). Ohne Präfix landete der Chart beim
// australischen Zertifikat statt beim Öl.
//
// Sämtliche Börsenkürzel unten stammen aus Abfragen gegen
// `symbol-search.tradingview.com` — keines ist aus dem Gedächtnis gesetzt.
// Wer hier einen Eintrag ergänzt, prüft ihn dort ebenso nach.
//
// Bewusst kein Anbieter-Zugriff: Das ist eine reine Funktion ohne Netz und
// ohne Datenbank. Die Marktdaten der App laufen weiterhin ausschließlich über
// `lookupProviderSymbol`; TradingView ist nur die eingebettete Fremdansicht.

import { COMMODITY_SPOT_ALIASES, FUTURES_ROOTS, INDEX_ALIASES } from './symbol-aliases'

/**
 * Terminkontrakt-Wurzel → TradingView-Börse. Schlüssel deckungsgleich mit
 * `FUTURES_ROOTS`; steht eine Wurzel dort, gehört sie auch hierher.
 */
export const FUTURES_TV_EXCHANGE: Record<string, string> = {
  // Energie — NYMEX
  CL: 'NYMEX',
  MCL: 'NYMEX',
  BZ: 'NYMEX',
  NG: 'NYMEX',
  RB: 'NYMEX',
  HO: 'NYMEX',
  // Edelmetalle — Gold/Silber/Kupfer an der COMEX, Platin/Palladium an der NYMEX
  GC: 'COMEX',
  MGC: 'COMEX',
  SI: 'COMEX',
  HG: 'COMEX',
  PL: 'NYMEX',
  PA: 'NYMEX',
  // Aktienindex-Terminkontrakte — Dow an der CBOT, der Rest an der CME
  ES: 'CME',
  MES: 'CME',
  NQ: 'CME',
  MNQ: 'CME',
  YM: 'CBOT',
  MYM: 'CBOT',
  RTY: 'CME',
  // Zinsen — CBOT
  ZB: 'CBOT',
  ZN: 'CBOT',
  ZF: 'CBOT',
  ZT: 'CBOT',
  // Agrar — Getreide an der CBOT, Softs an der ICE US
  ZC: 'CBOT',
  ZS: 'CBOT',
  ZW: 'CBOT',
  KC: 'ICEUS',
  CT: 'ICEUS',
  SB: 'ICEUS',
  CC: 'ICEUS',
  LE: 'CME',
  // Devisen-Terminkontrakte
  '6E': 'CME',
  '6J': 'CME',
  '6B': 'CME',
  DX: 'ICEUS',
}

/**
 * Terminkontrakt-Wurzel → frei abrufbare Entsprechung im Gratis-Embed.
 *
 * Warum es diese zweite Tabelle überhaupt gibt: Das eingebettete Widget
 * liefert die US-Terminbörsen nicht aus. Am 10.08.2026 im Embed nachgemessen —
 * `NYMEX:CL1!`, `COMEX:GC1!`, `CME:ES1!` und `CBOT:ZW1!` zeigen den richtigen
 * Namen, aber leere Kerzen (`O∅ H∅ L∅ C∅`); die verzögerten Feeds `NYMEX_DL:`
 * und `COMEX_DL:` ebenso. Ein exakt benannter, leerer Chart nützt beim
 * Draufschauen nichts.
 *
 * Deshalb steht hier, wo es nachweislich eine frei abrufbare Notierung
 * DESSELBEN Basiswerts gibt. Das ist der Benchmark-CFD, nicht der Kontrakt —
 * TradingView beschriftet ihn im Chart selbst so („CFDs auf WTI-Rohöl"), es
 * bleibt also sichtbar, was man sieht. Die Kennzahlen der App rührt das nicht
 * an: Kurse und Kerzen kommen weiter aus `CL=F` über Yahoo.
 *
 * Nicht eingetragen ist, was ebenfalls leer blieb: `TVC:NATGAS`,
 * `TVC:COPPER`, `TVC:DXY`. Erdgas, Kupfer und Dollar-Index behalten die
 * Börsenform — lieber ehrlich leer als ein anderes Instrument.
 */
export const FUTURES_TV_FREI: Record<string, string> = {
  CL: 'TVC:USOIL',
  MCL: 'TVC:USOIL',
  BZ: 'TVC:UKOIL',
  GC: 'TVC:GOLD',
  MGC: 'TVC:GOLD',
  SI: 'TVC:SILVER',
  PL: 'TVC:PLATINUM',
  PA: 'TVC:PALLADIUM',
}

/**
 * Yahoo-Indexsymbol → TradingView-Symbol.
 *
 * Der Umweg über Yahoo ist Absicht: `INDEX_ALIASES` führt rund fünfzig
 * Schreibweisen auf gut zwanzig Indizes zurück (`DAX`, `GER40`, `DE30` alle
 * auf `^GDAXI`). Diese Tabelle setzt deshalb am Ergebnis an und bleibt kurz.
 *
 * `TVC` ist TradingViews eigener Indexfeed, sonst steht die Heimatbörse.
 *
 * Anders als bei den Terminkontrakten gibt es hier nichts auszuweichen: Die
 * europäischen Indizes rendern im Embed (`XETR:DAX` nachgemessen), die
 * US-Indizes bleiben anonym leer — `TVC:SPX`, `SP:SPX`, `NASDAQ:NDX`,
 * `TVC:DJI` und `TVC:VIX` allesamt. Eine frei abrufbare Notierung desselben
 * Index existiert dort nicht; Broker-CFDs wären ein anderes Instrument. Also
 * steht hier die richtige Bezeichnung, und wer die Daten sehen will, meldet
 * sich bei TradingView an.
 */
export const INDEX_TV: Record<string, string> = {
  '^GDAXI': 'XETR:DAX',
  '^MDAXI': 'XETR:MDAX',
  '^SDAXI': 'XETR:SDXP',
  '^TECDAX': 'XETR:TDXP',
  '^GSPC': 'TVC:SPX',
  '^NDX': 'NASDAQ:NDX',
  '^IXIC': 'NASDAQ:IXIC',
  '^DJI': 'TVC:DJI',
  '^RUT': 'TVC:RUT',
  '^VIX': 'TVC:VIX',
  '^FTSE': 'FTSE:UKX',
  '^FCHI': 'TVC:CAC40',
  '^STOXX50E': 'TVC:SX5E',
  '^IBEX': 'TVC:IBEX35',
  '^SSMI': 'SIX:SMI',
  '^AEX': 'TVC:AEX',
  '^N225': 'TVC:NI225',
  '^HSI': 'HSI:HSI',
  '^AXJO': 'ASX:XJO',
}

/**
 * Yahoo-Börsenkürzel → TradingView-Präfix.
 *
 * Deckt die Plätze ab, die `EXCHANGE_PREFIX_SUFFIX` in `symbol-aliases.ts`
 * kennt. Ein unbekanntes Kürzel liefert bewusst nichts zurück — dann bleibt
 * der Rohticker stehen, und TradingView entscheidet wie bisher. Ein falsch
 * geratenes Präfix wäre schlimmer als gar keins.
 *
 * ACHTUNG: Das sind die KURZcodes aus Yahoos Suchtreffern (`exchange`). In
 * `stock.resolvedExchange` landet dagegen der Klarname (`fullExchangeName`) —
 * dafür steht `YAHOO_EXCHANGE_NAME_TO_TV` daneben. Beide Tabellen werden
 * abgefragt, weil je nach Weg das eine oder das andere gespeichert wurde.
 */
export const YAHOO_EXCHANGE_TO_TV: Record<string, string> = {
  // USA
  NMS: 'NASDAQ',
  NGM: 'NASDAQ',
  NCM: 'NASDAQ',
  NAS: 'NASDAQ',
  NYQ: 'NYSE',
  NYS: 'NYSE',
  ASE: 'AMEX',
  PCX: 'AMEX',
  BTS: 'BATS',
  // Deutschland
  GER: 'XETR',
  FRA: 'FWB',
  BER: 'FWB',
  MUN: 'FWB',
  STU: 'FWB',
  HAM: 'FWB',
  DUS: 'FWB',
  // Übriges Europa
  LSE: 'LSE',
  PAR: 'EURONEXT',
  AMS: 'EURONEXT',
  BRU: 'EURONEXT',
  LIS: 'EURONEXT',
  MIL: 'MIL',
  MCE: 'BME',
  EBS: 'SIX',
  VIE: 'VIE',
  CPH: 'OMXCOP',
  STO: 'OMXSTO',
  HEL: 'OMXHEX',
  OSL: 'OSL',
  // Rest der Welt
  HKG: 'HKEX',
  JPX: 'TSE',
  TOR: 'TSX',
  ASX: 'ASX',
  NSI: 'NSE',
  BSE: 'BSE',
  SAO: 'BMFBOVESPA',
  JNB: 'JSE',
}

/**
 * Yahoos Börsen-KLARNAME (`stock.resolvedExchange`) → TradingView-Präfix.
 *
 * Das ist der Wert, der tatsächlich in der Datenbank steht: Die Auflösung legt
 * `fullExchangeName` ab, nicht das Kürzel — also `XETRA` statt `GER`,
 * `NasdaqGS` statt `NMS`, `Paris` statt `PAR`. Ohne diese Tabelle traf die
 * Kurzcode-Liste nie, und jedes deutsche Papier ging als `RHM.DE` ans Widget.
 * TradingView kennt diese Schreibweise nicht — die Suche liefert darauf
 * Mailänder Anleihen statt Rheinmetall.
 *
 * Verglichen wird ohne Leerzeichen und in Großschreibung (`normalisiereBoerse`),
 * damit `Nasdaq GIDS` und `NasdaqGS` nicht an einem Leerzeichen scheitern.
 */
export const YAHOO_EXCHANGE_NAME_TO_TV: Record<string, string> = {
  // USA
  NASDAQ: 'NASDAQ',
  NASDAQGS: 'NASDAQ',
  NASDAQGM: 'NASDAQ',
  NASDAQCM: 'NASDAQ',
  NASDAQNM: 'NASDAQ',
  NYSE: 'NYSE',
  NYSEAMERICAN: 'AMEX',
  NYSEARCA: 'AMEX',
  CBOEUS: 'BATS',
  CBOEBZX: 'BATS',
  // Deutschland
  XETRA: 'XETR',
  FRANKFURT: 'FWB',
  BERLIN: 'FWB',
  MUNICH: 'FWB',
  STUTTGART: 'FWB',
  HAMBURG: 'FWB',
  DUSSELDORF: 'FWB',
  HANOVER: 'FWB',
  GETTEX: 'GETTEX',
  // Übriges Europa
  LSE: 'LSE',
  LONDON: 'LSE',
  PARIS: 'EURONEXT',
  AMSTERDAM: 'EURONEXT',
  BRUSSELS: 'EURONEXT',
  LISBON: 'EURONEXT',
  DUBLIN: 'EURONEXT',
  MILAN: 'MIL',
  MADRID: 'BME',
  SWISS: 'SIX',
  SIX: 'SIX',
  VIENNA: 'VIE',
  COPENHAGEN: 'OMXCOP',
  STOCKHOLM: 'OMXSTO',
  HELSINKI: 'OMXHEX',
  OSLO: 'OSL',
  // Rest der Welt
  HKSE: 'HKEX',
  TOKYO: 'TSE',
  TORONTO: 'TSX',
  TSXV: 'TSXV',
  // Cboe Canada (früher NEO) — Yahoo schreibt `Cboe CA`, TradingView `NEO`.
  CBOECA: 'NEO',
  NEO: 'NEO',
  ASX: 'ASX',
  NSE: 'NSE',
  BSE: 'BSE',
  SAOPAOLO: 'BMFBOVESPA',
  JOHANNESBURG: 'JSE',
}

/**
 * Yahoo-Suffix → TradingView-Präfix der HEIMATBÖRSE. Letzte Instanz.
 *
 * Greift, wenn die Börse gar nicht oder unter einem noch unbekannten Namen
 * gespeichert ist. Anders als sonst wird hier bewusst geraten, denn die
 * Alternative ist kein Raten, sondern ein sicherer Fehlschlag: Ein Symbol mit
 * Yahoo-Suffix (`RHM.DE`, `AIR.PA`, `1810.HK`) existiert bei TradingView
 * nicht. Die Heimatbörse ist damit immer die bessere Antwort als der Rohticker.
 *
 * Die Zuordnung folgt der Heimatbörsen-Rangfolge aus `EXCHANGE_PRIORITY`
 * (`symbol-aliases.ts`); die deutschen Regionalplätze laufen wie in der
 * Kurzcode-Tabelle auf Frankfurt zusammen, weil TradingView sie nicht einzeln
 * führt.
 */
export const YAHOO_SUFFIX_TO_TV: Record<string, string> = {
  '.DE': 'XETR',
  '.F': 'FWB',
  '.SG': 'FWB',
  '.MU': 'FWB',
  '.DU': 'FWB',
  '.HM': 'FWB',
  '.HA': 'FWB',
  '.BE': 'FWB',
  '.PA': 'EURONEXT',
  '.AS': 'EURONEXT',
  '.BR': 'EURONEXT',
  '.LS': 'EURONEXT',
  '.IR': 'EURONEXT',
  '.L': 'LSE',
  '.MI': 'MIL',
  '.MC': 'BME',
  '.SW': 'SIX',
  '.VI': 'VIE',
  '.CO': 'OMXCOP',
  '.ST': 'OMXSTO',
  '.HE': 'OMXHEX',
  '.OL': 'OSL',
  '.HK': 'HKEX',
  '.T': 'TSE',
  '.TO': 'TSX',
  '.V': 'TSXV',
  '.AX': 'ASX',
  '.NZ': 'NZX',
  '.NS': 'NSE',
  '.BO': 'BSE',
  '.KS': 'KRX',
  '.TW': 'TWSE',
  '.SA': 'BMFBOVESPA',
  '.MX': 'BMV',
  '.JO': 'JSE',
}

/** Vergleichsform einer Börsenangabe: ohne Leerzeichen, in Großschreibung. */
function normalisiereBoerse(exchange: string): string {
  return exchange.trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * Das TradingView-Präfix zu einer gespeicherten Börsenangabe — Kurzcode oder
 * Klarname, je nachdem, was die Auflösung hinterlassen hat.
 */
export function tvPraefixFuerBoerse(exchange: string | null | undefined): string | undefined {
  if (!exchange) return undefined
  const key = normalisiereBoerse(exchange)
  return YAHOO_EXCHANGE_TO_TV[key] ?? YAHOO_EXCHANGE_NAME_TO_TV[key]
}

/** Der Yahoo-Suffix eines Tickers (`RHM.DE` → `.DE`), sonst null. */
function yahooSuffix(ticker: string): string | null {
  const punkt = ticker.lastIndexOf('.')
  if (punkt <= 0) return null
  const suffix = ticker.slice(punkt)
  return suffix in YAHOO_SUFFIX_TO_TV ? suffix : null
}

/**
 * Trennt `CL1!` in Wurzel und Kontraktkennung; `CL2!` und `CL` gehen ebenso.
 *
 * Das `markt`-Argument ist kein Beiwerk: Ohne Ausrufezeichen sind viele
 * Wurzeln gleichzeitig Aktienkürzel — `SI`, `PL`, `GC` und `LE` gibt es alle
 * als Wertpapier. Ein Ticker ohne Kontraktkennung gilt deshalb nur dann als
 * Terminkontrakt, wenn er als Rohstoff geführt wird. Dieselbe Bedingung
 * verwendet der Symbol-Resolver (`resolve.ts`).
 */
function futuresRoot(ticker: string, markt: string): { root: string; contract: string } | null {
  const m = /^([A-Z0-9]{1,4}?)(\d*!?)$/.exec(ticker)
  if (!m) return null
  const root = m[1]
  if (!FUTURES_TV_EXCHANGE[root]) return null
  const hatKontraktkennung = m[2].endsWith('!')
  if (!hatKontraktkennung && markt !== 'rohstoffe') return null
  // Ohne Kontraktkennung ist der fortlaufende Kontrakt gemeint.
  return { root, contract: hatKontraktkennung ? m[2] : '1!' }
}

/**
 * Das Symbol für einen Terminkontrakt: frei abrufbare Entsprechung, wo es eine
 * gibt, sonst die Börsenform.
 *
 * Die freie Notierung kennt nur den fortlaufenden Basiswert, keine
 * Kontraktreihe. Wer ausdrücklich `CL2!` sehen will, meint einen bestimmten
 * Kontrakt — dann gewinnt die Börsenform, auch wenn sie leer bleibt.
 */
function kontraktSymbol(root: string, contract: string): string {
  if (contract === '1!' && FUTURES_TV_FREI[root]) return FUTURES_TV_FREI[root]
  return `${FUTURES_TV_EXCHANGE[root]}:${root}${contract}`
}

/** `CL=F` → `CL`. Gibt null zurück, wenn es kein Yahoo-Future-Symbol ist. */
function rootFromYahooFuture(yahooSymbol: string): string | null {
  const m = /^([A-Z0-9]+)=F$/.exec(yahooSymbol)
  return m ? m[1] : null
}

/**
 * Das Symbol, mit dem das TradingView-Widget aufgerufen wird.
 *
 * Rangfolge — von „der Nutzer hat es selbst festgelegt" zu „bestmögliche
 * Ableitung":
 * 1. `symbol=` aus dem gespeicherten Chart-Link (ausdrückliche Wahl)
 * 2. Ticker enthält bereits ein Präfix (`NASDAQ:AAPL`) → unverändert
 * 3. Index-Tabelle
 * 4. Terminkontrakt-Tabelle (auch über Spot-Aliasse wie `USOIL`)
 * 5. Krypto / Forex wie bisher
 * 6. Börse aus der gespeicherten Auflösung (Kurzcode ODER Klarname)
 * 7. Heimatbörse des Yahoo-Suffixes — ein `.DE`-Symbol darf nie durchgereicht
 *    werden, TradingView kennt diese Schreibweise nicht
 * 8. Rohticker — TradingView entscheidet, wie vor dieser Änderung
 */
export function toTradingViewSymbol(
  ticker: string,
  market: string,
  chartUrl: string | null,
  exchange?: string | null,
): string {
  if (chartUrl) {
    try {
      const fromUrl = new URL(chartUrl).searchParams.get('symbol')
      if (fromUrl) return fromUrl
    } catch {
      /* kein valider Link → normale Ableitung */
    }
  }

  const raw = ticker.trim().toUpperCase()
  if (!raw) return raw
  // Bereits vollqualifiziert (`NASDAQ:AAPL`) — nichts hinzuzufügen.
  if (raw.includes(':')) return raw

  const t = raw.replace('/', '')

  // Indizes: erst die Alias-Tabelle, dann das Caret-Format direkt.
  const indexYahoo = INDEX_ALIASES[t] ?? (t.startsWith('^') ? t : undefined)
  if (indexYahoo && INDEX_TV[indexYahoo]) return INDEX_TV[indexYahoo]

  // Terminkontrakte, direkt (`CL1!`) oder über eine Spotnotierung (`USOIL`).
  const viaSpot = COMMODITY_SPOT_ALIASES[t]
  const spotRoot = viaSpot ? rootFromYahooFuture(viaSpot) : null
  if (spotRoot && FUTURES_TV_EXCHANGE[spotRoot]) return kontraktSymbol(spotRoot, '1!')
  const fut = futuresRoot(t, market)
  if (fut) return kontraktSymbol(fut.root, fut.contract)

  // Yahoo-Schreibweise, falls sie doch als Ticker gespeichert wurde.
  const yahooRoot = rootFromYahooFuture(t)
  if (yahooRoot && FUTURES_TV_EXCHANGE[yahooRoot]) return kontraktSymbol(yahooRoot, '1!')

  if (market === 'krypto') {
    return t.endsWith('USDT') || t.endsWith('USD') ? `BINANCE:${t}` : `BINANCE:${t}USDT`
  }
  if (market === 'forex') return `FX:${t}`
  if (market === 'rohstoffe' && /^[A-Z]{6}$/.test(t)) return `OANDA:${t}`

  // Aktien und ETFs: Börse aus der bestätigten Auflösung. Der Ticker kann ein
  // Yahoo-Suffix tragen (`ADS.DE`) — TradingView will nur den nackten Teil.
  const tvExchange = tvPraefixFuerBoerse(exchange)
  if (tvExchange) return `${tvExchange}:${t.split('.')[0]}`

  // Ohne bekannte Börse, aber MIT Yahoo-Suffix: die Heimatbörse des Suffixes.
  // Den Ticker hier stehen zu lassen wäre kein „TradingView entscheidet",
  // sondern ein sicherer Fehlschlag — `RHM.DE` gibt es dort nicht.
  const suffix = yahooSuffix(t)
  if (suffix) return `${YAHOO_SUFFIX_TO_TV[suffix]}:${t.slice(0, t.length - suffix.length)}`

  return t
}

/** Die Wurzeln, für die noch kein TradingView-Präfix hinterlegt ist. */
export function futuresRootsOhneTvBoerse(): string[] {
  return Object.keys(FUTURES_ROOTS).filter((root) => !FUTURES_TV_EXCHANGE[root])
}

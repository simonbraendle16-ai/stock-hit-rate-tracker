// Feste Übersetzungen für Notationen, die eine Suche prinzipiell nicht auflösen
// kann — weil sie gar keine Wertpapiernamen sind, sondern Kürzel aus anderen
// Systemen (vor allem TradingView).
//
// Beispiel aus der eigenen Watchlist: `CL1!` ist TradingViews Schreibweise für
// den fortlaufenden WTI-Öl-Future. Yahoo kennt das Kürzel nicht, wohl aber
// `CL=F`. Keine Suche der Welt findet diese Brücke — sie muss hinterlegt sein.

/**
 * Terminkontrakt-Wurzeln: TradingView schreibt `CL1!`, Yahoo `CL=F`.
 * Der Schlüssel ist die Wurzel ohne Monats-/Fortlaufkennung.
 */
export const FUTURES_ROOTS: Record<string, string> = {
  // Energie
  CL: 'CL=F', // WTI Rohöl
  MCL: 'MCL=F', // Micro WTI
  BZ: 'BZ=F', // Brent
  NG: 'NG=F', // Erdgas
  RB: 'RB=F', // Benzin
  HO: 'HO=F', // Heizöl
  // Edel- und Industriemetalle
  GC: 'GC=F', // Gold
  MGC: 'MGC=F', // Micro Gold
  SI: 'SI=F', // Silber
  HG: 'HG=F', // Kupfer
  PL: 'PL=F', // Platin
  PA: 'PA=F', // Palladium
  // Aktienindex-Terminkontrakte
  ES: 'ES=F', // E-mini S&P 500
  MES: 'MES=F',
  NQ: 'NQ=F', // E-mini Nasdaq 100
  MNQ: 'MNQ=F',
  YM: 'YM=F', // E-mini Dow
  MYM: 'MYM=F',
  RTY: 'RTY=F', // E-mini Russell 2000
  // Zinsen
  ZB: 'ZB=F',
  ZN: 'ZN=F',
  ZF: 'ZF=F',
  ZT: 'ZT=F',
  // Agrar
  ZC: 'ZC=F', // Mais
  ZS: 'ZS=F', // Sojabohnen
  ZW: 'ZW=F', // Weizen
  KC: 'KC=F', // Kaffee
  CT: 'CT=F', // Baumwolle
  SB: 'SB=F', // Zucker
  CC: 'CC=F', // Kakao
  LE: 'LE=F', // Lebendrind
  // Devisen-Terminkontrakte
  '6E': '6E=F',
  '6J': '6J=F',
  '6B': '6B=F',
  DX: 'DX=F', // Dollar-Index
}

/**
 * Indizes. Nutzer schreiben sie mal als TradingView-Kürzel (`SPX500`, `GER40`),
 * mal umgangssprachlich (`DAX`) — Yahoo verlangt das Caret-Format.
 */
export const INDEX_ALIASES: Record<string, string> = {
  DAX: '^GDAXI',
  GER40: '^GDAXI',
  GER30: '^GDAXI',
  DE40: '^GDAXI',
  DE30: '^GDAXI',
  GDAXI: '^GDAXI',
  MDAX: '^MDAXI',
  SDAX: '^SDAXI',
  TECDAX: '^TECDAX',
  SPX: '^GSPC',
  SPX500: '^GSPC',
  SP500: '^GSPC',
  US500: '^GSPC',
  GSPC: '^GSPC',
  NDX: '^NDX',
  NAS100: '^NDX',
  US100: '^NDX',
  NASDAQ100: '^NDX',
  IXIC: '^IXIC',
  COMPQ: '^IXIC',
  DJI: '^DJI',
  US30: '^DJI',
  DOWJONES: '^DJI',
  RUT: '^RUT',
  US2000: '^RUT',
  VIX: '^VIX',
  FTSE: '^FTSE',
  UK100: '^FTSE',
  CAC: '^FCHI',
  CAC40: '^FCHI',
  FRA40: '^FCHI',
  FCHI: '^FCHI',
  STOXX50: '^STOXX50E',
  EU50: '^STOXX50E',
  SX5E: '^STOXX50E',
  IBEX: '^IBEX',
  SMI: '^SSMI',
  AEX: '^AEX',
  N225: '^N225',
  NIKKEI: '^N225',
  JP225: '^N225',
  HSI: '^HSI',
  HK50: '^HSI',
  ASX200: '^AXJO',
  AUS200: '^AXJO',
}

/**
 * Rohstoff-Spotnotierungen.
 *
 * Wichtig und nachgeprüft: Yahoo führt KEINEN echten Edelmetall-Spot. Weder
 * `XAUUSD=X` noch `XAU=X` existieren (beide antworten mit „No data found"). Die
 * nächstliegende verfügbare Notierung ist der Terminkontrakt — Gold `GC=F`,
 * Silber `SI=F`. Der folgt dem Spot bis auf die Basis (Zins- und Lagerkosten,
 * typischerweise wenige Promille) und rollt zum Fälligkeitstermin.
 *
 * Das ist eine Näherung, keine Gleichsetzung. Deshalb markiert der Resolver
 * solche Auflösungen als angenähert, und die Watchlist weist sie sichtbar aus —
 * ein Kurs, der vorgibt Spot zu sein, wäre schlimmer als ein beschrifteter
 * Future.
 */
export const COMMODITY_SPOT_ALIASES: Record<string, string> = {
  XAUUSD: 'GC=F',
  XAGUSD: 'SI=F',
  XPTUSD: 'PL=F',
  XPDUSD: 'PA=F',
  GOLD: 'GC=F',
  SILVER: 'SI=F',
  WTIUSD: 'CL=F',
  USOIL: 'CL=F',
  UKOIL: 'BZ=F',
  BRENT: 'BZ=F',
  NATGAS: 'NG=F',
  COPPER: 'HG=F',
}

/**
 * Börsenkürzel, die Nutzer aus TradingView mitkopieren (`NASDAQ:AAPL`), auf
 * Yahoos Suffix-Schreibweise. Ein leerer Wert heißt: US-Börse, kein Suffix.
 */
export const EXCHANGE_PREFIX_SUFFIX: Record<string, string> = {
  NASDAQ: '',
  NYSE: '',
  AMEX: '',
  ARCA: '',
  BATS: '',
  OTC: '',
  CBOE: '',
  XETR: '.DE',
  XETRA: '.DE',
  GETTEX: '.DE',
  FWB: '.F',
  TRADEGATE: '.DE',
  EURONEXT: '.PA',
  EPA: '.PA',
  AMS: '.AS',
  BME: '.MC',
  MIL: '.MI',
  LSE: '.L',
  LON: '.L',
  SIX: '.SW',
  OMXCOP: '.CO',
  CSE: '.CO',
  OMXSTO: '.ST',
  OMXHEX: '.HE',
  OSL: '.OL',
  HKEX: '.HK',
  SEHK: '.HK',
  TSE: '.T',
  TSX: '.TO',
  ASX: '.AX',
  NSE: '.NS',
  BSE: '.BO',
  JSE: '.JO',
  BMFBOVESPA: '.SA',
  BVMF: '.SA',
}

/**
 * Rangfolge der Börsensuffixe, wenn ein Ticker an mehreren Plätzen notiert.
 * Bewusst nach HEIMATBÖRSE sortiert: `ADS` soll XETRA in Euro liefern, nicht die
 * dünn gehandelte Stuttgarter oder Münchner Zweitnotierung. Kleinere Zahl =
 * höhere Priorität; nicht gelistete Suffixe landen hinten.
 */
export const EXCHANGE_PRIORITY: Record<string, number> = {
  '': 0, // US-Hauptbörsen (NYSE/NASDAQ) ohne Suffix
  '.DE': 1, // XETRA
  '.PA': 2, // Euronext Paris
  '.AS': 3, // Euronext Amsterdam
  '.BR': 4, // Euronext Brüssel
  '.MI': 5, // Borsa Italiana
  '.MC': 6, // Madrid
  '.LS': 7, // Lissabon
  '.L': 8, // London
  '.SW': 9, // SIX Swiss
  '.VI': 10, // Wien
  '.CO': 11, // Kopenhagen
  '.ST': 12, // Stockholm
  '.HE': 13, // Helsinki
  '.OL': 14, // Oslo
  '.IR': 15, // Dublin
  '.HK': 16, // Hongkong
  '.T': 17, // Tokio
  '.KS': 18, // Korea
  '.TW': 19, // Taiwan
  '.AX': 20, // Australien
  '.NZ': 21,
  '.TO': 22, // Toronto
  '.V': 23,
  '.SA': 24, // Brasilien
  '.MX': 25,
  '.NS': 26, // Indien NSE
  '.BO': 27,
  '.JO': 28,
  // Deutsche Regionalbörsen — funktionieren, sind aber selten gemeint.
  '.F': 40, // Frankfurt
  '.SG': 41, // Stuttgart
  '.MU': 42, // München
  '.DU': 43, // Düsseldorf
  '.HM': 44, // Hamburg
  '.HA': 45, // Hannover
  '.BE': 46, // Berlin
}

/** Suffixe, die beim Aufbau von Kandidaten für einen unbekannten Ticker taugen. */
export const CANDIDATE_SUFFIXES = [
  '',
  '.DE',
  '.PA',
  '.AS',
  '.MI',
  '.MC',
  '.L',
  '.SW',
  '.CO',
  '.ST',
  '.HE',
  '.OL',
  '.VI',
  '.BR',
  '.HK',
  '.T',
  '.AX',
  '.TO',
  '.NS',
  '.F',
]

/** Rechtsformen und Zusätze, die beim Namensvergleich nur stören. */
export const LEGAL_SUFFIXES = [
  'aktiengesellschaft',
  'incorporated',
  'corporation',
  'limited',
  'holdings',
  'holding',
  'company',
  'group',
  'kgaa',
  'se',
  'ag',
  'nv',
  'n.v.',
  'sa',
  's.a.',
  'plc',
  'inc',
  'inc.',
  'corp',
  'corp.',
  'ltd',
  'ltd.',
  'co',
  'co.',
  'inh',
  'na',
  'o.n.',
  'the',
]

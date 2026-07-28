// Symbolauflösung: aus dem, was der Nutzer eingetippt hat, wird ein Symbol, das
// beim Datenanbieter nachweislich existiert.
//
// Das Problem, das hier gelöst wird: Bisher ging der eingetippte Ticker
// ungeprüft an den Anbieter. Alles, was nicht zufällig exakt dessen Schreibweise
// traf, lieferte keinen Kurs — TradingView-Notation (`CL1!`), Heimatbörsen-
// Ticker ohne Börsensuffix (`ADS` statt `ADS.DE`), Indizes (`DAX` statt
// `^GDAXI`), Krypto-Paare (`BTCUSD` statt `BTC-USD`). Der Nutzer sah ein leeres
// Feld und wusste nicht, warum.
//
// Vorgehen in vier Stufen:
//   1. Kandidaten erzeugen — aus festen Übersetzungen, aus Normalisierungs-
//      regeln und aus der Volltextsuche über Ticker UND Name.
//   2. Alle Kandidaten in EINEM Batch-Request gegen echte Kurse prüfen. Was
//      keinen Kurs liefert, existiert für uns nicht.
//   3. Bewerten — Namensähnlichkeit, Übereinstimmung mit dem eingetippten
//      Ticker, Instrumentenart, Rangfolge der Heimatbörse.
//   4. Entscheiden: klarer Sieger → automatisch übernehmen; knappes Feld oder
//      schwache Treffer → als klärungsbedürftig markieren und die Kandidaten
//      zur manuellen Auswahl aufheben. Es wird nie still etwas Falsches
//      verknüpft.

import { Market } from './types'
import {
  CANDIDATE_SUFFIXES,
  COMMODITY_SPOT_ALIASES,
  EXCHANGE_PREFIX_SUFFIX,
  EXCHANGE_PRIORITY,
  FUTURES_ROOTS,
  INDEX_ALIASES,
  LEGAL_SUFFIXES,
} from './symbol-aliases'
import { getYahooQuotes, searchYahoo, YahooQuote } from './yahoo'

export type ResolutionStatus = 'ok' | 'ambiguous' | 'unresolved'

export interface ResolutionCandidate {
  symbol: string
  name: string
  exchange: string
  currency: string
  price: number
  /** 0–100. Ab `AUTO_ACCEPT_SCORE` gilt ein Kandidat als sicher genug. */
  score: number
  /** Wie der Kandidat entstanden ist — für die Erklärung in der Oberfläche. */
  via: string
}

export interface Resolution {
  status: ResolutionStatus
  /** Das gewählte Symbol — nur bei `ok` gesetzt. */
  symbol: string | null
  name: string | null
  exchange: string | null
  currency: string | null
  confidence: number
  /** Beste Kandidaten (auch bei `ok`), damit die Oberfläche korrigieren kann. */
  candidates: ResolutionCandidate[]
  /** Menschenlesbare Begründung — erscheint als Erklärung in der Watchlist. */
  note: string
  /**
   * Auflösung ist eine Näherung statt einer Entsprechung (z. B. Gold-Future
   * anstelle eines Spotkurses, den Yahoo nicht führt).
   */
  approximate: boolean
}

export interface ResolveInput {
  /** Was der Nutzer als Ticker eingetippt hat. */
  ticker: string
  /** Was der Nutzer als Namen eingetippt hat — oft die bessere Spur. */
  name: string
  market: Market
}

/**
 * Mindestabstand zum nächstbesten ANDEREN Instrument, damit ein Treffer als
 * eindeutig gilt. Notierungen desselben Instruments an verschiedenen Börsen
 * zählen hier ausdrücklich nicht gegeneinander — siehe `resolveSymbol`.
 */
export const AMBIGUITY_MARGIN = 12

// --- Textnormalisierung ----------------------------------------------------

/**
 * Faltet Umlaute und diakritische Zeichen aus. Ohne das scheitert die Suche an
 * genau den Werten, bei denen sie gebraucht wird — „SÜSS Microtec" findet bei
 * Yahoo nichts, „SUESS Microtec" dagegen sofort SMHN.
 */
export function foldDiacritics(input: string): string {
  return input
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Zerlegt einen Firmennamen in vergleichbare Bestandteile ohne Rechtsform. */
export function nameTokens(input: string): string[] {
  return foldDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !LEGAL_SUFFIXES.includes(t))
}

/**
 * Editierabstand mit Abbruch, sobald `max` überschritten ist.
 * Reicht für die hier gebrauchte Frage („ein, zwei Tippfehler?") und ist bei
 * kurzen Wörtern schneller als eine vollständige Matrix.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      row.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

/**
 * Gelten zwei Namensbestandteile als derselbe?
 *
 * Neben Gleichheit und Präfix („Alphabet" ↔ „Alphabet Inc.") wird ein kleiner
 * Tippfehler verziehen. Das ist hier kein Beiwerk, sondern der ausdrückliche
 * Zweck: Im Bestand stehen „Etherium" statt Ethereum und „Light Cruide Oil"
 * statt Crude Oil. Ohne diese Toleranz landet genau solches im Klärungsfach,
 * obwohl der gemeinte Wert eindeutig ist.
 *
 * Die Toleranz wächst NICHT mit der Wortlänge ins Beliebige — ein Fehler ab
 * fünf Zeichen, zwei ab acht. Sonst würden „Barrick" und „Warwick" gleich.
 */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true

  const shorter = Math.min(a.length, b.length)
  const longer = Math.max(a.length, b.length)

  // Präfix zählt nur, wenn der kürzere Teil den längeren wirklich trägt.
  // Ohne diese Schranke gilt „SAP" als Treffer für „Sappi" — und die
  // südafrikanische Sappi Ltd. verdrängt die SAP SE aus der Auflösung.
  if (a.startsWith(b) || b.startsWith(a)) {
    if (shorter >= 4 && shorter / longer >= 0.6) return true
    return false
  }

  if (shorter < 5) return false
  const tolerance = shorter >= 8 ? 2 : 1
  return editDistance(a, b, tolerance) <= tolerance
}

/**
 * Ähnlichkeit zweier Namen als Anteil gemeinsamer Bestandteile (0–1).
 *
 * Bewusst tokenbasiert statt zeichenweise: „Hannover Rueck SE" und
 * „HANNOVER RUECK SE NA O.N." sollen als derselbe Wert gelten, obwohl sich die
 * Zeichenketten deutlich unterscheiden.
 *
 * Gemittelt wird über die längere UND die kürzere Seite. Nur über die längere
 * zu rechnen bestraft knappe Anbieternamen zu hart: „Dax 40 Index" gegen „DAX P"
 * ergäbe 1/3, obwohl der Anbietername vollständig enthalten ist. Nur über die
 * kürzere zu rechnen wäre umgekehrt zu großzügig — der Mittelwert trifft beides.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  if (ta.length === 0 || tb.length === 0) return 0

  let hits = 0
  for (const t of ta) {
    if (tb.some((u) => tokensMatch(t, u))) hits++
  }
  const longer = Math.max(ta.length, tb.length)
  const shorter = Math.min(ta.length, tb.length)
  return (hits / longer + Math.min(1, hits / shorter)) / 2
}

// --- Kandidatenerzeugung ---------------------------------------------------

interface RawCandidate {
  symbol: string
  via: string
  /** Vorschuss aus der Herkunft — feste Übersetzungen wiegen schwerer als Raten. */
  bonus: number
  /**
   * Aus einer festen Übersetzungstabelle entstanden, nicht geraten. Solche
   * Zuordnungen sind maßgeblich, sobald ein echter Kurs sie bestätigt: Wer
   * `CL1!` eintippt, meint den WTI-Terminkontrakt — daran ändert auch ein
   * ähnlich benannter Öl-Fonds in den Suchtreffern nichts.
   */
  deterministic?: boolean
  /**
   * Instrumentenart, die diese Regel erwartet. Bestätigt der Anbieter sie, gilt
   * die Zuordnung nachträglich als deterministisch.
   *
   * Gebraucht für Muster, die für sich genommen mehrdeutig sind: `SOLUSD` KANN
   * das Krypto-Paar Solana sein — oder ein Wertpapierkürzel. Führt der Anbieter
   * das Ergebnis selbst als Kryptowährung, ist die Frage beantwortet, und die
   * gleichnamige „Solana Company" (eine Aktie) ist keine Konkurrenz mehr.
   */
  expectType?: string
  approximate?: boolean
  /** Name aus der Suche, falls vorhanden. */
  searchName?: string
  quoteType?: string
}

/** Trennt ein evtl. mitkopiertes Börsenkürzel ab: `NASDAQ:AAPL` → `AAPL` (US). */
function splitExchangePrefix(ticker: string): { base: string; suffix: string | null } {
  const m = ticker.match(/^([A-Z0-9_]+):(.+)$/)
  if (!m) return { base: ticker, suffix: null }
  const suffix = EXCHANGE_PREFIX_SUFFIX[m[1]]
  return { base: m[2], suffix: suffix === undefined ? null : suffix }
}

/** Der Ticker ohne TradingView-Fortlaufkennung: `CL1!` → `CL`, `YM2!` → `YM`. */
function futuresRoot(ticker: string): string | null {
  const m = ticker.match(/^([A-Z0-9]{1,3})[0-9]!$/)
  return m ? m[1] : null
}

/**
 * Baut die Kandidatenliste. Bewusst großzügig — geprüft wird anschließend
 * ohnehin jeder einzelne gegen einen echten Kurs, und alle Kandidaten kosten
 * zusammen nur einen Request.
 */
export async function buildCandidates(input: ResolveInput): Promise<RawCandidate[]> {
  const rawTicker = input.ticker.trim().toUpperCase()
  const { base, suffix: prefixSuffix } = splitExchangePrefix(rawTicker)
  const out: RawCandidate[] = []
  const seen = new Set<string>()

  const add = (c: RawCandidate) => {
    const key = c.symbol.toUpperCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(c)
  }

  // 1. Feste Übersetzungen — die einzige Chance für Notationen, die keine
  //    Suchmaschine kennt.
  const root = futuresRoot(base)
  if (root && FUTURES_ROOTS[root]) {
    add({
      symbol: FUTURES_ROOTS[root],
      via: 'Terminkontrakt-Kürzel',
      bonus: 55,
      deterministic: true,
    })
  }
  if (FUTURES_ROOTS[base] && (input.market === 'rohstoffe' || root)) {
    add({
      symbol: FUTURES_ROOTS[base],
      via: 'Terminkontrakt-Kürzel',
      bonus: 45,
      deterministic: true,
    })
  }
  if (INDEX_ALIASES[base]) {
    add({ symbol: INDEX_ALIASES[base], via: 'Index-Kürzel', bonus: 55, deterministic: true })
  }
  if (COMMODITY_SPOT_ALIASES[base]) {
    add({
      symbol: COMMODITY_SPOT_ALIASES[base],
      via: 'Rohstoff-Kürzel (Terminkontrakt als Näherung)',
      bonus: 48,
      deterministic: true,
      approximate: true,
    })
  }

  // 2. Marktspezifische Normalisierung.
  if (input.market === 'krypto') {
    const coin = base.replace(/(USDT|USDC|BUSD|USD|EUR)$/, '') || base
    add({ symbol: `${coin}-USD`, via: 'Krypto-Paar', bonus: 50, deterministic: true })
    if (base.endsWith('EUR')) {
      add({ symbol: `${coin}-EUR`, via: 'Krypto-Paar', bonus: 35, deterministic: true })
    }
  }
  if (input.market === 'forex') {
    const pair = base.replace(/[^A-Z]/g, '')
    if (/^[A-Z]{6}$/.test(pair)) {
      add({ symbol: `${pair}=X`, via: 'Devisenpaar', bonus: 55, deterministic: true })
    }
  }
  // Krypto-Paare tauchen erfahrungsgemäß auch unter „aktien" auf (BTCUSD,
  // ETHUSD, SOLUSD) — der Markt ist beim Anlegen schnell falsch gewählt. Das
  // gilt NICHT als deterministisch: `XYZUSD` könnte auch ein Wertpapierkürzel
  // sein, deshalb muss der Name hier mittragen.
  if (/^[A-Z]{2,5}USD$/.test(base) && input.market !== 'forex') {
    add({
      symbol: `${base.slice(0, -3)}-USD`,
      via: 'Krypto-Paar (Markt korrigiert)',
      bonus: 34,
      expectType: 'CRYPTOCURRENCY',
    })
  }

  // 3. Der eingetippte Ticker selbst und seine Börsenvarianten. Der Ticker ist
  //    das stärkste Indiz für den gemeinten Handelsplatz: Wer „ADS" eintippt,
  //    meint XETRA, nicht die US-Hinterlegung „ADDYY".
  if (prefixSuffix !== null) {
    add({ symbol: `${base}${prefixSuffix}`, via: 'Börsenkürzel aus der Eingabe', bonus: 35 })
  }
  // Gattungstrenner vereinheitlichen: `NOVO_B` wird bei Yahoo `NOVO-B`.
  const stems = new Set<string>([base])
  if (base.includes('_')) stems.add(base.replace(/_/g, '-'))

  for (const stem of stems) {
    if (!/^[A-Z0-9._\-=^]{1,12}$/.test(stem)) continue
    for (const sfx of CANDIDATE_SUFFIXES) {
      // Enthält der Ticker bereits einen Punkt oder ein Sonderzeichen, ist er
      // vermutlich schon vollständig — dann keine Suffixe anhängen. Ein
      // Bindestrich ist dabei kein Sonderzeichen, sondern Gattungstrenner.
      if (sfx && /[.=^]/.test(stem)) continue
      add({
        symbol: `${stem}${sfx}`,
        via: sfx ? `Börsenvariante ${sfx}` : 'Ticker direkt',
        bonus: 0,
      })
    }
  }

  // 4. Suche — über den Ticker und über den Namen. Der Name rettet die Fälle,
  //    in denen der Ticker schlicht falsch ist.
  const queries = new Set<string>()
  queries.add(base)
  if (input.name.trim()) {
    queries.add(input.name.trim())
    const folded = foldDiacritics(input.name.trim())
    if (folded !== input.name.trim()) queries.add(folded)
    // Ohne Rechtsform findet die Suche deutlich zuverlässiger.
    const core = nameTokens(input.name).join(' ')
    if (core && core !== folded.toLowerCase()) queries.add(core)
  }

  const results = await Promise.allSettled(
    Array.from(queries).map((q) => searchYahoo(q, 8)),
  )
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const hit of r.value) {
      add({
        symbol: hit.symbol,
        via: 'Suche',
        bonus: 0,
        searchName: hit.name,
        quoteType: hit.quoteType,
      })
    }
  }

  return out
}


// --- Bewertung -------------------------------------------------------------
//
// Getrennt bewertet werden zwei völlig verschiedene Fragen, deren Vermischung
// der erste Anlauf noch nicht sauber hinbekam:
//
//   1. IST ES DAS RICHTIGE INSTRUMENT? — Namensübereinstimmung, Tickerwurzel,
//      Instrumentenart. Das ist der `score`.
//   2. AN WELCHEM HANDELSPLATZ? — adidas gibt es an XETRA, Zürich, Wien und
//      vier deutschen Regionalbörsen. Das ist NICHT dieselbe Frage: alle sieben
//      sind „richtig", nur einer ist gemeint (laut Festlegung die Heimatbörse).
//
// Würde der Handelsplatz in den `score` einfließen, lägen die sieben adidas-
// Einträge dicht beieinander und die Auflösung meldete „mehrdeutig" — obwohl
// überhaupt keine Unklarheit darüber besteht, WELCHE Aktie gemeint ist.
// Mehrdeutigkeit wird deshalb ausschließlich zwischen verschiedenen
// INSTRUMENTEN geprüft; unter Notierungen desselben Instruments entscheidet
// allein die Rangfolge der Börsen.

/**
 * Welche Instrumenten-KLASSE zum eingestellten Markt passt.
 *
 * Verglichen wird die Klasse und nicht die exakte Art: Wer ein Instrument unter
 * „Aktien" führt, meint auch dann das Richtige, wenn der Anbieter es als Fonds
 * einsortiert (Hinterlegungsscheine tragen bei Yahoo `ETF`). Ein Krypto-Paar
 * unter „Aktien" ist dagegen wirklich etwas anderes.
 *
 * Rohstoffe lassen beides zu — sie werden mal als Terminkontrakt, mal als
 * börsengehandelte Ware geführt.
 */
const MARKET_CLASSES: Record<Market, string[]> = {
  aktien: ['wertpapier'],
  etf: ['wertpapier'],
  krypto: ['krypto'],
  forex: ['devisen'],
  rohstoffe: ['termin', 'wertpapier'],
  optionen: ['option'],
  // Bewusst ohne Erwartung: „Sonstiges" heißt, der Nutzer legt sich nicht fest.
  sonstiges: [],
}

function suffixOf(symbol: string): string {
  const idx = symbol.lastIndexOf('.')
  return idx === -1 ? '' : symbol.slice(idx)
}

/**
 * Tickerwurzel ohne Börsensuffix, vergleichbar gemacht.
 * Unterstrich und Bindestrich werden gleichgesetzt: Für Aktiengattungen
 * schreiben die Systeme mal `NOVO_B`, mal `NOVO-B`, mal `NOVO.B` — gemeint ist
 * dieselbe B-Aktie.
 */
function baseOf(symbol: string): string {
  const idx = symbol.lastIndexOf('.')
  return (idx === -1 ? symbol : symbol.slice(0, idx)).toUpperCase().replace(/_/g, '-')
}

/** Rang des Handelsplatzes; kleiner ist besser, Unbekanntes landet hinten. */
export function venueRank(symbol: string): number {
  const prio = EXCHANGE_PRIORITY[suffixOf(symbol)]
  return prio === undefined ? 60 : prio
}

/** Die Belege, auf denen eine Zuordnung ruht. */
interface Evidence {
  /** Aus einer festen Übersetzungstabelle — deterministisch, nicht geraten. */
  aliasDerived: boolean
  /** Die Tickerwurzel des Kandidaten ist exakt die eingetippte. */
  baseMatch: boolean
  /** Das ganze Symbol ist exakt das eingetippte. */
  exactSymbol: boolean
  /** 0–1. */
  nameSim: number
  /** Instrumentenart passt zum eingestellten Markt. */
  typeMatch: boolean | null
}

/**
 * Reine Instrumentenbewertung, 0–100 — OHNE Handelsplatz (siehe oben).
 * Die Gewichte sind so gesetzt, dass ein Volltreffer (gleiche Tickerwurzel plus
 * übereinstimmender Name) sicher über der Annahmeschwelle landet, eines von
 * beiden allein aber nicht.
 */
export function scoreEvidence(e: Evidence, bonus: number): number {
  let score = bonus
  if (e.baseMatch) score += 40
  // Das eingetippte Kürzel existiert wörtlich. Bewusst kräftig gewichtet: Sonst
  // verliert „AMD" (Advanced Micro Devices) gegen „AMD.AX" (Arrow Minerals),
  // das über dieselbe Tickerwurzel mitkommt — beide tragen `baseMatch`, aber nur
  // eines ist wirklich das, was dort steht.
  if (e.exactSymbol) score += 14
  score += Math.round(e.nameSim * 45)
  // Die Marktwahl des Nutzers wiegt schwer. Zu schwach gewichtet gewinnt sonst
  // ein gleichnamiges Wertpapier gegen das gemeinte Instrument: Bei Markt
  // „Krypto” und Ticker „SOL” schlug die italienische SOL S.p.A. das Krypto-Paar
  // Solana, weil ihr Name exakt passte.
  if (e.typeMatch === true) score += 12
  // Bestraft wird aber NIE eine deterministische Übersetzung. Der eingestellte
  // Markt ist eine grobe Ablage des Nutzers — im Bestand steht schlicht alles
  // unter „Aktien”, auch Indizes und Terminkontrakte. Das Kürzel `DAX` sagt
  // eindeutiger, was gemeint ist, als die Schublade, in der es liegt; würde die
  // Schublade hier gewinnen, landete `DAX` auf einem DAX-ETF statt auf dem Index.
  if (e.typeMatch === false && !e.aliasDerived) score -= 25
  return Math.max(0, Math.min(100, Math.round(score)))
}

function gatherEvidence(
  input: ResolveInput,
  candidate: RawCandidate,
  quote: YahooQuote,
): Evidence {
  const typed = splitExchangePrefix(input.ticker.trim().toUpperCase()).base
  const providerName = quote.name ?? candidate.searchName ?? ''
  const wanted = MARKET_CLASSES[input.market] ?? []
  return {
    aliasDerived:
      candidate.deterministic === true ||
      (!!candidate.expectType && quote.quoteType === candidate.expectType),
    baseMatch: baseOf(quote.symbol) === baseOf(typed),
    exactSymbol: quote.symbol.toUpperCase() === typed,
    nameSim:
      providerName && input.name.trim() ? nameSimilarity(input.name, providerName) : 0,
    typeMatch: (() => {
      // Aus der Kursantwort, ersatzweise aus der Suche — siehe `YahooQuote`.
      const cls = instrumentClass(quote.quoteType ?? candidate.quoteType ?? null)
      return cls && wanted.length > 0 ? wanted.includes(cls) : null
    })(),
  }
}

/**
 * Reicht die Beweislage, um ohne Rückfrage zu übernehmen?
 *
 * Bewusst als benannte Bedingungen statt als Zahlenschwelle: „gleiche
 * Tickerwurzel UND passender Name" ist eine überprüfbare Aussage, „Wert über 72"
 * ist es nicht.
 */
export function isConfident(e: Evidence): boolean {
  if (e.aliasDerived) return true // deterministische Übersetzung
  // Das eingetippte Kürzel existiert beim Anbieter WÖRTLICH und handelt. Dann
  // hat der Nutzer schlicht einen gültigen Ticker eingegeben — dass sein
  // Klarname davon abweicht, ist der Normalfall und kein Warnzeichen: „AMD"
  // heißt bei Yahoo „Advanced Micro Devices, Inc.", „Robin Hood" heißt
  // „Robinhood Markets, Inc.". Der Schutz gegen ein zufällig existierendes
  // Falschkürzel ist nicht der Name, sondern der Abstand zum nächstbesten
  // anderen Papier (`AMBIGUITY_MARGIN`) — der greift unmittelbar danach.
  if (e.exactSymbol) return true
  if (e.baseMatch && e.nameSim >= 0.34) return true
  if (e.nameSim >= 0.7) return true // Name spricht für sich, Ticker war falsch
  return false
}

/**
 * Grobe Instrumentenklasse. Feiner zu unterscheiden schadet hier mehr als es
 * nützt — siehe die Begründung in `sameInstrument`.
 */
export function instrumentClass(quoteType: string | null): string | null {
  if (!quoteType) return null
  switch (quoteType.toUpperCase()) {
    case 'EQUITY':
    case 'ETF':
    case 'MUTUALFUND':
      return 'wertpapier'
    case 'CRYPTOCURRENCY':
      return 'krypto'
    case 'CURRENCY':
      return 'devisen'
    case 'INDEX':
      return 'index'
    case 'FUTURE':
      return 'termin'
    case 'OPTION':
      return 'option'
    default:
      return quoteType.toUpperCase()
  }
}

/**
 * Sind das zwei Notierungen DESSELBEN Papiers?
 *
 * Über den Namen allein ist das nicht zu beantworten — jede Börse schreibt ihn
 * anders, und zwar bis zur Unkenntlichkeit: Dieselbe Aktie heißt an XETRA
 * „Bayerische Motoren Werke Aktiengesellschaft" und in Zürich schlicht
 * „BMW AG". Diese beiden Namen haben keinen einzigen Bestandteil gemeinsam.
 *
 * Tragfähig ist stattdessen die Kombination aus Tickerwurzel und BILANZWÄHRUNG.
 * Die Bilanzwährung gehört zum Unternehmen, nicht zum Handelsplatz, und ist
 * deshalb über alle Notierungen hinweg gleich — sie trennt zugleich das, was
 * sich nur zufällig eine Tickerwurzel teilt: `SAP` steht an der NYSE für die
 * SAP SE (bilanziert in EUR) und in Johannesburg für die Sappi Ltd. (ZAR).
 *
 * Fehlt die Bilanzwährung (bei Regionalbörsen häufig), entscheidet der
 * Namensvergleich als Rückfallebene.
 */
export function sameInstrument(a: Evaluated, b: Evaluated): boolean {
  if (a.symbol === b.symbol) return true

  // Verschiedene Instrumentenklassen sind nie dasselbe Papier — und der
  // Namensvergleich allein würde hier zuverlässig irren: „Solana USD" (die
  // Kryptowährung) und „Solana Company" (eine Aktie) teilen sich den Namen,
  // „DAX P" (der Index) und „Global X DAX Germany ETF" ebenso.
  //
  // Verglichen wird die KLASSE, nicht die exakte Art. Aktie und Fonds landen
  // absichtlich in derselben Klasse, weil Yahoo Hinterlegungsscheine als Fonds
  // führt: Die Toronto-Zeile von Fiserv trägt `ETF`, die Nasdaq-Zeile `EQUITY` —
  // dasselbe Unternehmen. Würde hier die exakte Art verlangt, gälten die beiden
  // als verschiedene Papiere, und die praktisch handelslose Toronto-Notierung
  // käme durch.
  const ca = instrumentClass(a.quoteType)
  const cb = instrumentClass(b.quoteType)
  if (ca && cb && ca !== cb) return false

  if (baseOf(a.symbol) !== baseOf(b.symbol)) {
    // Andere Tickerwurzel — nur bei deutlich gleichem Namen dasselbe Papier
    // (etwa `NVO` und `NOVO-B.CO` für Novo Nordisk).
    return nameSimilarity(a.name, b.name) >= 0.6
  }
  if (a.financialCurrency && b.financialCurrency) {
    return a.financialCurrency === b.financialCurrency
  }
  return nameSimilarity(a.name, b.name) >= 0.4
}

// --- Auflösung -------------------------------------------------------------

interface Evaluated extends ResolutionCandidate {
  evidence: Evidence
  approximate: boolean
  rank: number
  volume: number | null
  /** Bilanzwährung des Unternehmens — Identitätsmerkmal, siehe `sameInstrument`. */
  financialCurrency: string | null
  /** EQUITY | ETF | INDEX | FUTURE | CRYPTOCURRENCY | … — ebenfalls Identität. */
  quoteType: string | null
  /** Handelt diese Notierung in der Bilanzwährung des Unternehmens? */
  homeCurrency: boolean
  /**
   * Praktisch handelsloser Handelsplatz — wird erst im Vergleich mit den
   * übrigen Notierungen desselben Papiers gesetzt (siehe
   * `NEGLIGIBLE_VOLUME_SHARE`).
   */
  negligible: boolean
}

/**
 * Reihenfolge der Notierungen DESSELBEN Instruments — die Frage „an welcher
 * Börse?", nicht „welcher Wert?". Festlegung: Heimatbörse in Landeswährung.
 *
 * Drei Kriterien in dieser Reihenfolge:
 *
 * 1. TICKERWURZEL. Wer `NOVO_B` eintippt, meint Kopenhagen — auch wenn die
 *    US-Hinterlegung `NVO` reger gehandelt wird.
 *
 * 2. HEIMATWÄHRUNG. Der Anbieter liefert neben der Handelswährung auch die
 *    Bilanzwährung des Unternehmens (`financialCurrency`). Die Notierung, deren
 *    Handelswährung damit übereinstimmt, ist die Heimatnotierung. SAP handelt
 *    an der NYSE in USD und an XETRA in EUR und bilanziert in EUR — also XETRA.
 *    Für Apple stimmen beide auf USD überein, dort bleibt es bei der NASDAQ.
 *
 * 3. HANDELSVOLUMEN. Bleiben mehrere Plätze in der Heimatwährung übrig (bei
 *    deutschen Werten typischerweise XETRA plus sechs Regionalbörsen),
 *    entscheidet der Umsatz. Mercedes-Benz kommt an XETRA auf ein Vielfaches
 *    von München.
 *
 * Warum nicht gleich das Volumen? Weil es die falsche Frage beantwortet: Es
 * findet den liquidesten Platz, und das ist bei SAP und ASML die US-Notierung
 * in Dollar — genau nicht das Gewünschte.
 */
function compareVenues(a: Evaluated, b: Evaluated): number {
  // 0. Eine deterministische Übersetzung steht über allem. `NDX` bildet auf den
  //    Index `^NDX` ab; dass daneben ein Eintrag namens `NDX` existiert, dessen
  //    Kürzel dem Eingetippten wörtlich gleicht, darf das nicht aushebeln.
  if (a.evidence.aliasDerived !== b.evidence.aliasDerived) {
    return a.evidence.aliasDerived ? -1 : 1
  }
  // 1. Karteileichen aussortieren, bevor irgendein anderes Kriterium greift.
  if (a.negligible !== b.negligible) {
    return a.negligible ? 1 : -1
  }
  if (a.evidence.baseMatch !== b.evidence.baseMatch) {
    return a.evidence.baseMatch ? -1 : 1
  }
  if (a.homeCurrency !== b.homeCurrency) {
    return a.homeCurrency ? -1 : 1
  }
  const va = a.volume ?? 0
  const vb = b.volume ?? 0
  // Erst ab deutlichem Abstand entscheiden — ähnliche Umsätze sagen nichts.
  if (va > 0 && vb > 0 && Math.max(va, vb) / Math.min(va, vb) >= 1.5) {
    return vb - va
  }
  // Kein brauchbares Volumen (Index, geschlossene Börse) → feste Rangfolge.
  return a.rank - b.rank || b.score - a.score
}

/**
 * Anteil am umsatzstärksten Handelsplatz desselben Papiers, unterhalb dessen
 * eine Notierung als Karteileiche gilt.
 *
 * Hintergrund aus dem echten Bestand: Spotify ist in Luxemburg ansässig und
 * bilanziert in Euro, wird aber an der NYSE gehandelt. Die Wiener Notierung
 * `SPOT.VI` erfüllt die Heimatwährungs-Regel formal perfekt — und kommt auf ein
 * Durchschnittsvolumen von eben ELF Stück pro Tag. Denselben Effekt gibt es bei
 * `NDX` (Volumen 0 gegen 9,6 Mrd. beim echten Index) und bei der Toronto-Zeile
 * von Fiserv. Solche Einträge liefern zwar einen Kurs, aber keinen, an dem sich
 * irgendjemand orientieren würde.
 *
 * Zwei Prozent ist bewusst niedrig angesetzt: Es soll nur ausschließen, was
 * praktisch nicht handelt, und keine echte Zweitbörse verwerfen (Amsterdam
 * kommt bei ASML auf rund 37 Prozent der US-Notierung).
 */
export const NEGLIGIBLE_VOLUME_SHARE = 0.02

/**
 * Löst ein einzelnes Instrument auf. Prüft jeden Kandidaten gegen einen echten
 * Kurs — ein Ergebnis mit Status `ok` bedeutet also nicht „sieht plausibel aus",
 * sondern „dieser Kurs wurde soeben abgerufen".
 */
export async function resolveSymbol(input: ResolveInput): Promise<Resolution> {
  const empty = (note: string): Resolution => ({
    status: 'unresolved',
    symbol: null,
    name: null,
    exchange: null,
    currency: null,
    confidence: 0,
    candidates: [],
    note,
    approximate: false,
  })

  if (!input.ticker.trim() && !input.name.trim()) {
    return empty('Weder Ticker noch Name angegeben.')
  }

  let raw: RawCandidate[]
  try {
    raw = await buildCandidates(input)
  } catch {
    return empty('Die Symbolsuche war nicht erreichbar — später erneut versuchen.')
  }
  if (raw.length === 0) return empty('Keine Kandidaten gefunden.')

  // Alle Kandidaten in EINEM Rutsch gegen echte Kurse prüfen. Was hier keinen
  // Kurs liefert, existiert für uns nicht — unabhängig davon, wie gut es klang.
  let quotes: Map<string, YahooQuote>
  try {
    quotes = await getYahooQuotes(raw.map((c) => c.symbol))
  } catch {
    return empty('Kursprüfung nicht möglich — Datenanbieter antwortet nicht.')
  }

  const evaluated: Evaluated[] = []
  for (const c of raw) {
    const q = quotes.get(c.symbol.toUpperCase())
    if (!q || !(q.price > 0)) continue // existiert nicht oder handelt nicht
    const evidence = gatherEvidence(input, c, q)
    const name = q.name ?? c.searchName ?? q.symbol
    evaluated.push({
      symbol: q.symbol,
      name,
      exchange: q.exchange ?? '',
      currency: q.currency ?? '',
      price: q.price,
      score: scoreEvidence(evidence, c.bonus),
      via: c.via,
      evidence,
      approximate: c.approximate ?? false,
      rank: venueRank(q.symbol),
      volume: q.volume,
      financialCurrency: q.financialCurrency,
      quoteType: q.quoteType ?? c.quoteType ?? null,
      homeCurrency:
        !!q.currency && !!q.financialCurrency && q.currency === q.financialCurrency,
      negligible: false, // wird unten je Papier bestimmt
    })
  }

  if (evaluated.length === 0) {
    return empty(
      `Für „${input.ticker}“ liefert kein passendes Symbol einen Kurs. Bitte manuell zuordnen.`,
    )
  }

  // Zwei getrennte Entscheidungen, in dieser Reihenfolge:
  //
  //   WELCHES PAPIER? — die höchste Punktzahl. Sie fällt fast immer auf die
  //   Notierung, deren Name am besten passt, und die ist nicht zwangsläufig die
  //   gewünschte Börse („BMW AG" in Zürich schlägt namentlich „Bayerische
  //   Motoren Werke Aktiengesellschaft" an XETRA).
  //
  //   WELCHE BÖRSE? — unter allen Notierungen ebendieses Papiers entscheidet
  //   `compareVenues` (Heimatwährung, dann Umsatz). Die Punktzahl spielt hier
  //   ausdrücklich keine Rolle mehr.
  const byScore = [...evaluated].sort((a, b) => b.score - a.score)
  const identified = byScore[0]
  const family = evaluated.filter((c) => sameInstrument(identified, c))

  // Karteileichen erkennen: Der Maßstab ist der umsatzstärkste Handelsplatz
  // DESSELBEN Papiers — absolute Schwellen taugen nicht, weil ein Nebenwert
  // insgesamt weniger umsetzt als eine Zweitnotierung von Apple.
  const maxVolume = Math.max(0, ...family.map((c) => c.volume ?? 0))
  if (maxVolume > 0) {
    for (const c of family) {
      c.negligible = (c.volume ?? 0) < maxVolume * NEGLIGIBLE_VOLUME_SHARE
    }
  }

  const winner = [...family].sort(compareVenues)[0]

  // Für die Mehrdeutigkeitsprüfung zählt nur, was ein ANDERES Papier ist.
  const outsider = byScore.find((c) => !sameInstrument(identified, c)) ?? null
  const margin = outsider ? identified.score - outsider.score : 100

  // Anzeigeliste für die Korrektur: erst die anderen Handelsplätze desselben
  // Papiers, dann die konkurrierenden Papiere.
  const candidates: ResolutionCandidate[] = [
    strip(winner),
    ...[...family]
      .sort(compareVenues)
      .filter((c) => c.symbol !== winner.symbol)
      .map(strip),
    ...byScore.filter((c) => !sameInstrument(identified, c)).map(strip),
  ].slice(0, 8)

  if (!isConfident(identified.evidence)) {
    return {
      status: 'ambiguous',
      symbol: null,
      name: null,
      exchange: null,
      currency: null,
      confidence: winner.score,
      candidates,
      note:
        `Kein Treffer ist belegt genug: „${winner.symbol}“ (${winner.name}) passt weder ` +
        `im Kürzel noch deutlich genug im Namen zu „${input.ticker} / ${input.name}“. Bitte auswählen.`,
      approximate: false,
    }
  }

  // Eine deterministische Übersetzung ist maßgeblich: Wer „CL1!" schreibt,
  // meint den WTI-Terminkontrakt und keinen Öl-Fonds, der zufällig ähnlich
  // heißt. Deshalb greift hier die Mehrdeutigkeitsprüfung ausdrücklich nicht.
  if (!identified.evidence.aliasDerived && margin < AMBIGUITY_MARGIN && outsider) {
    return {
      status: 'ambiguous',
      symbol: null,
      name: null,
      exchange: null,
      currency: null,
      confidence: identified.score,
      candidates,
      note:
        `Zwei verschiedene Werte liegen dicht beieinander: „${winner.symbol}“ (${winner.name}) ` +
        `und „${outsider.symbol}“ (${outsider.name}). Bitte auswählen.`,
      approximate: false,
    }
  }

  return {
    status: 'ok',
    symbol: winner.symbol,
    name: winner.name,
    exchange: winner.exchange,
    currency: winner.currency,
    confidence: winner.score,
    candidates,
    note: winner.approximate
      ? `Über ${winner.via} zugeordnet — Näherung, kein exakter Spotkurs.`
      : `Über ${winner.via} zugeordnet und mit einem echten Kurs bestätigt.`,
    approximate: winner.approximate,
  }
}

function strip(c: Evaluated): ResolutionCandidate {
  return {
    symbol: c.symbol,
    name: c.name,
    exchange: c.exchange,
    currency: c.currency,
    price: c.price,
    score: c.score,
    via: c.via,
  }
}

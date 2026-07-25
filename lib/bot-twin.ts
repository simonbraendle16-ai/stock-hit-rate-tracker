// Bot-Zwilling (Etappe 5) — die reine Rechenlogik.
//
// Die App kennt den Plan (Einstieg, Stop, Ziel) und den tatsächlichen Kursverlauf.
// Daraus lässt sich ausrechnen, was passiert WÄRE, wenn der Plan mechanisch
// ausgeführt worden wäre: ohne Zögern, ohne vorzeitigen Ausstieg, ohne
// verschobenen Stop. Die Differenz zum echten Ergebnis ist der Preis des eigenen
// Eingreifens — und sie darf ausdrücklich auch positiv sein. Dann ist nicht der
// Trader das Problem, sondern der Plan. Beide Richtungen sind ein Befund, keine
// Bewertung.
//
// Hier steht ausschließlich Mathematik: keine Datenbank, kein Netz, kein React.
// Die Kerzen kommen von außen (`app/actions/bot-twin.ts`), damit diese Datei
// vollständig testbar bleibt.
//
// Bewusst NICHT neu erfunden: ob eine Kerze ein Level berührt, entscheidet
// `candleReachesLevel` aus `lib/alerts.ts` — dieselbe Regel, mit der auch
// Kurs-Alerts auslösen. Zwei Wahrheiten darüber, was „Stop berührt" heißt, wären
// ein Fehler mit Ansage.

import { candleReachesLevel, directionForLevel } from '@/lib/alerts'
import type { Candle, Interval } from '@/lib/market-data/types'

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** Wie der mechanisch ausgeführte Plan geendet hätte. */
export type BotOutcome = 'ziel' | 'stop' | 'offen'

/**
 * Warum ein Trade NICHT simuliert werden konnte. Wird sichtbar ausgewiesen statt
 * still ausgelassen — eine Differenz, die verschweigt, auf wie vielen Trades sie
 * steht, ist manipulativ.
 */
export type BotSkipReason =
  | 'kein_ziel' // ohne Take-Profit gibt es keinen mechanischen Ausstieg
  | 'kein_risiko' // Stop = Einstieg → 1 R wäre nicht definiert
  | 'kein_zeitpunkt' // openedAt fehlt (Altbestand)
  | 'keine_kerzen' // Provider liefert für dieses Symbol nichts
  | 'historie_zu_kurz' // Kerzen reichen nicht bis zum Einstieg zurück
  | 'nicht_abgerufen' // Minutenlimit des Anbieters erreicht, diesmal nicht geladen
  | 'unbekanntes_symbol' // der Anbieter kennt diesen Ticker nicht
  | 'nicht_unterstuetzt' // für diesen Markt gibt es im Gratis-Tier keine Kurse
  | 'kursdaten_fehler' // sonstiger Fehler beim Anbieter
  | 'nicht_ausgeloest' // nur bei nicht eingegangenen Trades: Einstieg nie erreicht

/** Alles, was die Simulation eines Trades braucht — bewusst schmal gehalten. */
export type BotTrade = {
  id: number
  ticker: string
  direction: 'long' | 'short'
  entryPrice: number
  stopLoss: number
  takeProfit: number | null
  /** Stückzahl der ursprünglichen Position (Hebel steckt bereits darin). */
  quantity: number
  /** Eingefrorene Ordergebühren Kauf + Verkauf; 0 bei Demo-Trades. */
  fees: number
  /** 1 R in Kontowährung — kommt von außen, damit Bot und Realität denselben Nenner teilen. */
  plannedRisk: number
  /** Ab wann gerechnet wird (Unix-Sekunden): Einstieg bzw. Planung. */
  fromSec: number
}

export type BotRun =
  | { simulated: false; reason: BotSkipReason }
  | {
      simulated: true
      outcome: BotOutcome
      exitPrice: number
      /** Unix-Sekunden der Kerze, in der der Bot ausgestiegen wäre. */
      exitSec: number
      grossPnl: number
      netPnl: number
      rMultiple: number
      candlesUsed: number
      /**
       * Stop UND Ziel lagen in derselben Kerze. Die Kerze verrät nicht, was
       * zuerst kam — gewertet wird der Stop. Die Zahl der betroffenen Trades
       * steht in der Auswertung, weil sie den Bot systematisch schlechter macht.
       */
      ambiguous: boolean
    }

/** Woher das Bot-Ergebnis eines Trades stammt. */
export type BotSource = 'kurse' | 'nachgetragen'

/** Ein gespeicherter Nachtrag — was der Nutzer für diesen Trade angegeben hat. */
export type ManualOutcome = { outcome: BotOutcome; exitPrice: number | null }

/**
 * Wo die Differenz entsteht. Ein Trade landet in genau einem Eimer, die Eimer
 * summieren sich exakt auf die Gesamtdifferenz.
 */
export type BotBucket =
  | 'wie_geplant' // Abweichung unter der Schwelle — der Plan wurde gehandelt
  | 'zu_frueh' // Bot lief weiter (Ziel oder noch offen), du warst vorher raus
  | 'zu_spaet' // Bot wäre am Stop raus, du bist darüber hinaus geblieben
  | 'stop_verschoben' // dokumentierter Regelbruch erklärt die Differenz
  | 'besser_als_plan' // du warst besser als der mechanische Plan

/** Unterhalb dieser Differenz in R gilt ein Trade als plan-konform ausgeführt. */
export const BUCKET_EPS = 0.05

export const BUCKET_LABELS: Record<BotBucket, string> = {
  wie_geplant: 'Wie geplant gehandelt',
  zu_frueh: 'Zu früh ausgestiegen',
  zu_spaet: 'Zu spät ausgestiegen',
  stop_verschoben: 'Stop verschoben',
  besser_als_plan: 'Besser als der Plan',
}

export const SKIP_LABELS: Record<BotSkipReason, string> = {
  kein_ziel: 'kein Ziel definiert',
  kein_risiko: 'Stop gleich Einstieg',
  kein_zeitpunkt: 'kein Einstiegszeitpunkt',
  keine_kerzen: 'keine Kursdaten',
  historie_zu_kurz: 'Historie reicht nicht zurück',
  nicht_abgerufen: 'diesmal nicht abgerufen (Minutenlimit)',
  unbekanntes_symbol: 'Ticker beim Anbieter unbekannt',
  nicht_unterstuetzt: 'keine Gratis-Kursdaten für diesen Markt',
  kursdaten_fehler: 'Kursabruf fehlgeschlagen',
  nicht_ausgeloest: 'Einstieg nie erreicht',
}

/** Alles, was die Nachtrag-Bedienung an einer Zeile braucht. */
type Editable = {
  /** Ohne Ziel im Plan gibt es kein „Ziel erreicht" zum Nachtragen. */
  hasTarget: boolean
  manual: ManualOutcome | null
}

/** Eine Zeile der Auswertung: echter Trade gegen mechanischen Plan. */
export type BotTwinRow = Editable & {
  tradeId: number
  ticker: string
  label: string
  realR: number
  botR: number
  diffR: number
  outcome: BotOutcome
  bucket: BotBucket
  source: BotSource
  ambiguous: boolean
  resolution: Interval | null
}

/** Ein Trade, für den kein Bot-Ergebnis vorliegt — mit Grund, nicht stillschweigend. */
export type BotTwinGap = Editable & {
  tradeId: number
  ticker: string
  label: string
  reason: BotSkipReason
  realR: number | null
}

/** Ein geplanter, nie eingegangener Trade (Status `kein_handel`). */
export type MissedRow = Editable & {
  tradeId: number
  ticker: string
  label: string
  botR: number
  outcome: BotOutcome
  source: BotSource
  ambiguous: boolean
  resolution: Interval | null
}

export type MissedStats = {
  /** Trades mit auswertbarem Ergebnis. */
  evaluated: number
  /** Summe in R — positiv heißt: diese Trades hätten Geld gebracht. */
  totalR: number
  rows: MissedRow[]
  gaps: BotTwinGap[]
  /** Einstieg wurde nie erreicht — der Trade war also gar nicht möglich. */
  neverTriggered: number
}

export type BotTwinStats = {
  /** Zahl der Trades, die verglichen werden konnten. */
  compared: number
  /** Abgeschlossene Trades insgesamt — der Nenner für die Abdeckung. */
  closed: number
  botTotalR: number
  realTotalR: number
  /**
   * realTotalR − botTotalR, also **deine Seite minus Bot**.
   * Negativ = dein Eingreifen hat gekostet. Positiv = du warst besser als dein
   * Plan; dann gehört der Plan überarbeitet, nicht das Verhalten.
   */
  differenceR: number
  buckets: { bucket: BotBucket; trades: number; r: number }[]
  /** Kumulierte R-Verläufe für die Doppelkurve. */
  points: { label: string; bot: number; real: number }[]
  rows: BotTwinRow[]
  gaps: BotTwinGap[]
  /** Wie viele der verglichenen Ergebnisse von Hand nachgetragen wurden. */
  manualCount: number
  /** Trades, bei denen Stop und Ziel in derselben Kerze lagen. */
  ambiguousCount: number
  /** Gröbste verwendete Auflösung — bestimmt, wie belastbar die Reihenfolge ist. */
  resolutions: Interval[]
  /** Nicht eingegangene Trades, streng getrennt von der Hauptdifferenz. */
  missed: MissedStats
}

// ---------------------------------------------------------------------------
// Simulation eines einzelnen Trades
// ---------------------------------------------------------------------------

function skip(reason: BotSkipReason): BotRun {
  return { simulated: false, reason }
}

function usableCandles(candles: readonly Candle[]): Candle[] {
  return candles
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    .sort((a, b) => a.time - b.time)
}

/**
 * Der mechanisch ausgeführte Plan, Kerze für Kerze.
 *
 * 1. Stop berührt → Verlust exakt am Stop
 * 2. Ziel berührt → Gewinn exakt am Ziel
 * 3. beides in derselben Kerze → **konservativ der Stop**. Die Kerze verrät
 *    nicht, was zuerst kam; die pessimistische Annahme verhindert, dass der Bot
 *    künstlich gut aussieht.
 * 4. keins von beidem → offen, bewertet zum letzten verfügbaren Kurs
 *
 * Der Bot hält bewusst **über den echten Ausstieg hinaus**, bis Stop oder Ziel
 * berührt sind. Genau darin steckt die Differenz: ein vorzeitiger Ausstieg wäre
 * sonst per Konstruktion gleichwertig mit dem Plan und nie messbar.
 *
 * Gerechnet wird mit denselben eingefrorenen Gebühren wie beim echten Trade —
 * sonst vergleicht man Äpfel mit Birnen.
 */
export function simulateTrade(t: BotTrade, candles: readonly Candle[]): BotRun {
  if (t.takeProfit == null || !Number.isFinite(t.takeProfit)) return skip('kein_ziel')
  if (!Number.isFinite(t.plannedRisk) || t.plannedRisk <= 0) return skip('kein_risiko')
  if (!Number.isFinite(t.fromSec) || t.fromSec <= 0) return skip('kein_zeitpunkt')

  const all = usableCandles(candles)
  if (all.length === 0) return skip('keine_kerzen')
  // Reicht die gelieferte Historie bis zum Einstieg zurück? Sonst fehlt womöglich
  // genau die Kerze, in der der Stop lag — ein Ergebnis wäre geraten.
  if (all[0].time > t.fromSec) return skip('historie_zu_kurz')

  // Erst ab der Kerze rechnen, die NACH dem Einstieg beginnt. Die angebrochene
  // Einstiegskerze enthält auch Bewegung vor dem Einstieg; sie mitzuzählen würde
  // Stops auslösen, die es nie gab.
  const window = all.filter((c) => c.time >= t.fromSec)
  if (window.length === 0) return skip('historie_zu_kurz')

  const stopDir = t.direction === 'short' ? 'above' : 'below'
  const targetDir = t.direction === 'short' ? 'below' : 'above'
  const target = t.takeProfit

  for (let i = 0; i < window.length; i++) {
    const c = window[i]
    const hitStop = candleReachesLevel(stopDir, t.stopLoss, c)
    const hitTarget = candleReachesLevel(targetDir, target, c)
    if (hitStop) return settle(t, 'stop', t.stopLoss, c.time, i + 1, hitTarget)
    if (hitTarget) return settle(t, 'ziel', target, c.time, i + 1, false)
  }

  const last = window[window.length - 1]
  return settle(t, 'offen', last.close, last.time, window.length, false)
}

/**
 * Ein geplanter, nie eingegangener Trade (Status `kein_handel`).
 *
 * Erst muss der Einstieg überhaupt erreicht worden sein — vorher gibt es nichts
 * zu bewerten. Die Richtung des Einstiegs (von oben oder von unten) wird aus dem
 * ersten verfügbaren Kurs abgeleitet, mit derselben Funktion, die auch beim
 * Anlegen eines Kurs-Alerts entscheidet.
 */
export function simulateMissedTrade(t: BotTrade, candles: readonly Candle[]): BotRun {
  if (t.takeProfit == null || !Number.isFinite(t.takeProfit)) return skip('kein_ziel')
  if (!Number.isFinite(t.plannedRisk) || t.plannedRisk <= 0) return skip('kein_risiko')
  if (!Number.isFinite(t.fromSec) || t.fromSec <= 0) return skip('kein_zeitpunkt')

  const all = usableCandles(candles)
  if (all.length === 0) return skip('keine_kerzen')
  if (all[0].time > t.fromSec) return skip('historie_zu_kurz')

  const window = all.filter((c) => c.time >= t.fromSec)
  if (window.length === 0) return skip('historie_zu_kurz')

  // Von wo läuft der Kurs auf den Einstieg zu? Liegt der Einstieg genau auf dem
  // Bezugskurs, gilt er als sofort erreicht.
  const entryDir = directionForLevel(t.entryPrice, window[0].close)
  const entryIndex = entryDir
    ? window.findIndex((c) => candleReachesLevel(entryDir, t.entryPrice, c))
    : 0
  if (entryIndex < 0) return skip('nicht_ausgeloest')

  // Ab der Einstiegskerze läuft der ganz normale Plan. Dass Stop oder Ziel in
  // derselben Kerze wie der Einstieg liegen können, ist genau der Fall, den die
  // konservative Stop-Regel abdeckt.
  return simulateTrade(
    { ...t, fromSec: window[entryIndex].time },
    window.slice(entryIndex),
  )
}

/**
 * Ein von Hand nachgetragener Ausgang (Etappe 5, Nachtrag).
 *
 * Nur für Trades gedacht, die der Bot mangels Kursdaten nicht rechnen kann. Bei
 * `ziel`/`stop` ergibt sich der Kurs aus dem Plan selbst — nachgetragen wird also
 * nur die Aussage „es lief ins Ziel" bzw. „es lief in den Stop", nicht ein frei
 * erfundener Betrag. Nur ein offener Ausgang braucht einen eigenen Kurs.
 *
 * `ambiguous` bleibt false: eine Handeingabe hat keine Kerze, in der etwas
 * uneindeutig sein könnte.
 */
export function manualOutcomeRun(
  t: BotTrade,
  outcome: BotOutcome,
  exitPrice: number | null,
): BotRun {
  if (!Number.isFinite(t.plannedRisk) || t.plannedRisk <= 0) return skip('kein_risiko')

  if (outcome === 'ziel') {
    if (t.takeProfit == null || !Number.isFinite(t.takeProfit)) return skip('kein_ziel')
    return settle(t, 'ziel', t.takeProfit, 0, 0, false)
  }
  if (outcome === 'stop') return settle(t, 'stop', t.stopLoss, 0, 0, false)

  if (exitPrice == null || !Number.isFinite(exitPrice)) return skip('keine_kerzen')
  return settle(t, 'offen', exitPrice, 0, 0, false)
}

function settle(
  t: BotTrade,
  outcome: BotOutcome,
  exitPrice: number,
  exitSec: number,
  candlesUsed: number,
  ambiguous: boolean,
): BotRun {
  const signedQty = t.direction === 'short' ? -t.quantity : t.quantity
  const grossPnl = (exitPrice - t.entryPrice) * signedQty
  const netPnl = grossPnl - t.fees
  return {
    simulated: true,
    outcome,
    exitPrice,
    exitSec,
    grossPnl,
    netPnl,
    rMultiple: netPnl / t.plannedRisk,
    candlesUsed,
    ambiguous,
  }
}

// ---------------------------------------------------------------------------
// Zuordnung: wo entsteht die Differenz?
// ---------------------------------------------------------------------------

/**
 * Ein Trade, ein Eimer. Die Reihenfolge der Prüfungen ist die Aussage:
 * ein dokumentierter Regelbruch erklärt die Differenz besser als jede Vermutung
 * über den Ausstiegszeitpunkt.
 *
 * `diffR` ist immer **deine Seite minus Bot** — negativ heißt: das Eingreifen hat
 * gekostet, positiv heißt: du warst besser als der Plan.
 */
export function classifyDifference(
  diffR: number,
  outcome: BotOutcome,
  violations: readonly string[],
): BotBucket {
  if (Math.abs(diffR) < BUCKET_EPS) return 'wie_geplant'
  if (diffR > 0) return 'besser_als_plan'
  if (violations.includes('stop_moved')) return 'stop_verschoben'
  // Der Bot wäre am Stop raus, du hast mehr verloren → du bist darüber hinaus
  // geblieben. In allen anderen Fällen lief der Plan weiter als du.
  return outcome === 'stop' ? 'zu_spaet' : 'zu_frueh'
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Was der Aufrufer je abgeschlossenem Trade beisteuert. */
export type BotTwinEntry = Editable & {
  tradeId: number
  ticker: string
  /** Beschriftung für Kurve und Tabelle (Abschlussdatum). */
  label: string
  /** R-Vielfaches des ECHTEN Trades — event-aware, aus `lib/trade-stats.ts`. */
  realR: number
  violations: readonly string[]
  run: BotRun
  source: BotSource
  /** Kerzen-Auflösung, mit der gerechnet wurde. */
  resolution: Interval | null
}

/** Was der Aufrufer je nicht eingegangenem Trade beisteuert. */
export type MissedEntry = Editable & {
  tradeId: number
  ticker: string
  label: string
  run: BotRun
  source: BotSource
  resolution: Interval | null
}

const BUCKET_ORDER: BotBucket[] = [
  'zu_frueh',
  'zu_spaet',
  'stop_verschoben',
  'besser_als_plan',
  'wie_geplant',
]

/**
 * Der Vergleich über alle Trades: zwei Summen, eine Differenz, und die
 * Aufschlüsselung, wo sie entsteht.
 *
 * Die Reihenfolge der Einträge bestimmt die Kurve — der Aufrufer liefert sie
 * chronologisch nach Abschluss.
 */
export function compareBotAndTrader(
  entries: readonly BotTwinEntry[],
  missedEntries: readonly MissedEntry[] = [],
  closedTotal?: number,
): BotTwinStats {
  const rows: BotTwinRow[] = []
  const gaps: BotTwinGap[] = []

  for (const e of entries) {
    if (!e.run.simulated) {
      gaps.push({
        tradeId: e.tradeId,
        ticker: e.ticker,
        label: e.label,
        reason: e.run.reason,
        realR: e.realR,
        hasTarget: e.hasTarget,
        manual: e.manual,
      })
      continue
    }
    const botR = e.run.rMultiple
    const diffR = e.realR - botR
    rows.push({
      tradeId: e.tradeId,
      ticker: e.ticker,
      label: e.label,
      realR: e.realR,
      botR,
      diffR,
      outcome: e.run.outcome,
      bucket: classifyDifference(diffR, e.run.outcome, e.violations),
      source: e.source,
      ambiguous: e.run.ambiguous,
      resolution: e.resolution,
      hasTarget: e.hasTarget,
      manual: e.manual,
    })
  }

  const botTotalR = sum(rows.map((r) => r.botR))
  const realTotalR = sum(rows.map((r) => r.realR))

  const buckets = BUCKET_ORDER.map((bucket) => {
    const inBucket = rows.filter((r) => r.bucket === bucket)
    return { bucket, trades: inBucket.length, r: sum(inBucket.map((r) => r.diffR)) }
  }).filter((b) => b.trades > 0)

  // Kumulierte Verläufe: beide Kurven starten bei 0 R und laufen über dieselben
  // Trades — nur so ist die Schere zwischen ihnen die Differenz.
  const points: BotTwinStats['points'] = [{ label: 'Start', bot: 0, real: 0 }]
  let bot = 0
  let real = 0
  for (const r of rows) {
    bot += r.botR
    real += r.realR
    points.push({ label: r.label, bot: round(bot), real: round(real) })
  }

  const resolutions = [...new Set(rows.map((r) => r.resolution).filter(Boolean))] as Interval[]

  return {
    compared: rows.length,
    closed: closedTotal ?? rows.length + gaps.length,
    botTotalR,
    realTotalR,
    differenceR: realTotalR - botTotalR,
    buckets,
    points,
    rows,
    gaps,
    manualCount: rows.filter((r) => r.source === 'nachgetragen').length,
    ambiguousCount: rows.filter((r) => r.ambiguous).length,
    resolutions,
    missed: aggregateMissed(missedEntries),
  }
}

function aggregateMissed(entries: readonly MissedEntry[]): MissedStats {
  const rows: MissedRow[] = []
  const gaps: BotTwinGap[] = []
  let neverTriggered = 0

  for (const e of entries) {
    if (!e.run.simulated) {
      if (e.run.reason === 'nicht_ausgeloest') neverTriggered++
      gaps.push({
        tradeId: e.tradeId,
        ticker: e.ticker,
        label: e.label,
        reason: e.run.reason,
        realR: null,
        hasTarget: e.hasTarget,
        manual: e.manual,
      })
      continue
    }
    rows.push({
      tradeId: e.tradeId,
      ticker: e.ticker,
      label: e.label,
      botR: e.run.rMultiple,
      outcome: e.run.outcome,
      source: e.source,
      ambiguous: e.run.ambiguous,
      resolution: e.resolution,
      hasTarget: e.hasTarget,
      manual: e.manual,
    })
  }

  return {
    evaluated: rows.length,
    totalR: sum(rows.map((r) => r.botR)),
    rows,
    gaps,
    neverTriggered,
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

// ---------------------------------------------------------------------------
// Kerzen-Auflösung
// ---------------------------------------------------------------------------

/**
 * Von grob nach fein: welche Auflösungen kommen überhaupt in Frage?
 *
 * `15min` fehlt bewusst — im Gratis-Tier reichen 500 Kerzen damit nur ~19
 * Handelstage zurück, ältere Trades wären grundsätzlich nicht simulierbar.
 */
export const BOT_INTERVALS: Interval[] = ['1h', '4h', '1day']

/**
 * Kerzen-Auflösung nach Haltedauer (adaptiv).
 *
 * Kurze Trades brauchen feine Kerzen, sonst liegt fast alles in einer einzigen
 * Tageskerze und die konservative Stop-Regel entscheidet praktisch jeden Trade.
 * Lange Trades brauchen dagegen Reichweite: 500 Stundenkerzen decken keine
 * Monate ab. Reicht die Historie der bevorzugten Auflösung nicht zurück, fällt
 * der Aufrufer auf die nächstgröbere zurück (`BOT_INTERVALS`).
 */
export function preferredInterval(spanHours: number): Interval {
  if (!Number.isFinite(spanHours) || spanHours <= 0) return '1day'
  if (spanHours <= 72) return '1h' // bis 3 Tage
  if (spanHours <= 24 * 30) return '4h' // bis ~1 Monat
  return '1day'
}

/** Anzeigename der Auflösung für die Ehrlichkeitszeile unter der Auswertung. */
export function intervalLabel(interval: Interval): string {
  switch (interval) {
    case '15min':
      return '15-Minuten-Kerzen'
    case '30min':
      return '30-Minuten-Kerzen'
    case '1h':
      return 'Stundenkerzen'
    case '4h':
      return '4-Stunden-Kerzen'
    case '1day':
      return 'Tageskerzen'
    case '1week':
      return 'Wochenkerzen'
    case '1month':
      return 'Monatskerzen'
  }
}

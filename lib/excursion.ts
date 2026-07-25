// MAE / MFE (Etappe 7c) — wie weit lief der Kurs während der Haltedauer gegen
// dich, und wie weit für dich?
//
// Reine Rechnung ohne DB, Auth oder React: Eingang sind ein schmaler Trade und
// die Kerzen seiner Haltedauer, Ausgang zwei Zahlen in R. Die Kerzen selbst
// kommen von außen — auf `/tracking` aus demselben Durchlauf wie der
// Bot-Zwilling, damit kein Symbol zweimal abgerufen wird.
//
// Abgrenzung zum Bot-Zwilling: der rechnet den Plan **über den echten Ausstieg
// hinaus** weiter („was wäre passiert"). MAE/MFE misst ausschließlich die Zeit,
// in der die Position wirklich offen war („was ist passiert, während ich drin
// war"). Zwei verschiedene Fragen, dieselben Kerzen.

import type { Candle } from '@/lib/market-data/types'
import { type BotSkipReason } from '@/lib/bot-twin'

/** Ab wie vielen Trades eine Gruppe eine Aussage trägt. */
export const MIN_EXCURSION_TRADES = 5

/**
 * Warum ein Trade nicht messbar war. Bewusst derselbe Katalog wie beim
 * Bot-Zwilling (`SKIP_LABELS` beschriftet beide) — zwei Gründe-Listen für
 * dieselben Kursdaten-Probleme würden unweigerlich auseinanderlaufen.
 *
 * `kein_ziel` fehlt: MAE/MFE braucht **kein** Take-Profit. Trades, die der Bot
 * mangels Ziel überspringt, sind hier trotzdem messbar.
 */
export type ExcursionSkipReason = Exclude<BotSkipReason, 'kein_ziel' | 'nicht_ausgeloest'>

/** Woher die Zahlen eines Trades stammen. */
export type ExcursionSource = 'kurse' | 'nachgetragen'

/** Alles, was die Messung eines Trades braucht. */
export type ExcursionInput = {
  direction: 'long' | 'short'
  entryPrice: number
  /** |Einstieg − Stop| in Kurspunkten — der Nenner von 1 R. */
  riskDistance: number
  /** Einstieg und Ausstieg als Unix-Sekunden. */
  fromSec: number
  toSec: number
}

export type ExcursionRun =
  | { measured: false; reason: ExcursionSkipReason }
  | {
      measured: true
      /** Tiefster Punkt gegen die Position, in R. Immer ≤ 0. */
      maeR: number
      /** Höchster Punkt für die Position, in R. Immer ≥ 0. */
      mfeR: number
      /** Die Kurse dahinter — was man am Chart wiederfindet. */
      worstPrice: number
      bestPrice: number
      candlesUsed: number
      /**
       * Die Kerzen sind gröber als die Haltedauer — das Extrem kann aus Zeit
       * stammen, in der gar keine Position offen war. Solche Messungen zählen
       * mit, werden aber gekennzeichnet und dürfen von einer Handeingabe
       * überstimmt werden (siehe `resolveRun`).
       */
      coarse: boolean
    }

/** Ein von Hand nachgetragenes Extrem — gespeichert werden Kurse, nie R-Werte. */
export type ManualExcursion = {
  worstPrice: number | null
  bestPrice: number | null
}

/** Eine Trade-Zeile der Auswertung. */
export type ExcursionEntry = {
  tradeId: number
  ticker: string
  label: string
  /** Der tatsächlich erzielte R des Trades — event-aware von außen gereicht. */
  realR: number
  /** Gewinn oder Verlust; nur entschiedene Trades werden ausgewertet. */
  won: boolean
  run: ExcursionRun
  source: ExcursionSource
  /** Anzeigename der verwendeten Auflösung, `null` bei Nachtrag. */
  resolution: string | null
  manual: ManualExcursion | null
}

/** Eine Zeile der Auswertung (Gewinner, Verlierer, alle). */
export type ExcursionBucket = {
  key: 'gewinner' | 'verlierer' | 'gesamt'
  label: string
  /** Messbare Trades dieser Gruppe — der Nenner aller Mittelwerte. */
  trades: number
  avgMae: number
  avgMfe: number
  /** Ø tatsächlich erzielter R derselben Trades — der Bezug für die MFE. */
  avgExitR: number
  /** Schlechtester Einzelwert: der tiefste Gegenlauf der Gruppe. */
  worstMae: number
  enough: boolean
}

/**
 * Was die Zahlen nahelegen — als **Daten**, nicht als Satz. Formuliert wird im
 * Panel, und zwar als Beobachtung ohne Imperativ: der Block stellt fest, er
 * ordnet nicht an. Eine Auswertung, die dem Trader sagt, was er zu tun hat,
 * ersetzt genau das Urteil, das Douglas ihm abverlangt.
 */
export type ExcursionObservation =
  | { kind: 'stops'; gapR: number }
  | { kind: 'ziele'; gapR: number }

export type ExcursionCoverage = {
  /** Entschiedene, abgeschlossene Trades insgesamt. */
  decided: number
  measured: number
  /** Davon grob gemessen (Kerze länger als die Haltedauer). */
  coarse: number
  manual: number
  /** Nicht messbar, nach Grund gruppiert — nichts verschwindet stumm. */
  gaps: { reason: ExcursionSkipReason; count: number }[]
}

export type ExcursionStats = {
  minGroupSize: number
  buckets: ExcursionBucket[]
  coverage: ExcursionCoverage
  observations: ExcursionObservation[]
  /** Verwendete Auflösungen, gröbste zuerst — die Ehrlichkeitszeile. */
  resolutions: string[]
}

function fail(reason: ExcursionSkipReason): ExcursionRun {
  return { measured: false, reason }
}

/** Nur Kerzen mit brauchbaren Zahlen, chronologisch — wie im Bot-Zwilling. */
function usable(candles: readonly Candle[]): Candle[] {
  return candles
    .filter(
      (c) =>
        Number.isFinite(c.time) && Number.isFinite(c.high) && Number.isFinite(c.low),
    )
    .sort((a, b) => a.time - b.time)
}

/** Kursbewegung in Richtung der Position (long: hoch = gut, short: umgekehrt). */
function favourable(price: number, entry: number, direction: 'long' | 'short'): number {
  return direction === 'short' ? entry - price : price - entry
}

/**
 * MAE/MFE eines Trades aus den Kerzen seiner Haltedauer.
 *
 * **Fenster:** ab der ersten Kerze, die NACH dem Einstieg beginnt — die
 * angebrochene Einstiegskerze enthält auch Bewegung von vor dem Einstieg, sie
 * würde ein Extrem ausweisen, das nie zur Position gehörte (dieselbe Regel wie
 * `simulateTrade`). Die Kerze, in der der Ausstieg liegt, zählt dagegen **mit**:
 * ohne sie fiele bei kurzen Trades das Fenster leer aus. Der Preis dafür steht
 * im `coarse`-Flag — je gröber die Kerze im Verhältnis zur Haltedauer, desto
 * mehr Fremdbewegung steckt in ihr.
 *
 * Gemessen werden **Hoch und Tief**, nicht Schlusskurse: der Stop wird vom Tief
 * getroffen, nicht vom Schluss.
 */
export function computeExcursion(t: ExcursionInput, candles: readonly Candle[]): ExcursionRun {
  if (!Number.isFinite(t.riskDistance) || t.riskDistance <= 0) return fail('kein_risiko')
  if (!Number.isFinite(t.fromSec) || t.fromSec <= 0) return fail('kein_zeitpunkt')
  if (!Number.isFinite(t.toSec) || t.toSec < t.fromSec) return fail('kein_zeitpunkt')

  const all = usable(candles)
  if (all.length === 0) return fail('keine_kerzen')
  // Reicht die Historie nicht bis zum Einstieg zurück, fehlt womöglich genau die
  // Kerze mit dem Extrem — eine Zahl wäre dann geraten.
  if (all[0].time > t.fromSec) return fail('historie_zu_kurz')

  const window = all.filter((c) => c.time >= t.fromSec && c.time <= t.toSec)
  if (window.length === 0) return fail('historie_zu_kurz')

  let worstPrice = t.entryPrice
  let bestPrice = t.entryPrice
  for (const c of window) {
    // Long: Tief ist der Gegenlauf, Hoch der Mitlauf. Short: umgekehrt.
    const adverse = t.direction === 'short' ? c.high : c.low
    const favour = t.direction === 'short' ? c.low : c.high
    if (favourable(adverse, t.entryPrice, t.direction) < favourable(worstPrice, t.entryPrice, t.direction)) {
      worstPrice = adverse
    }
    if (favourable(favour, t.entryPrice, t.direction) > favourable(bestPrice, t.entryPrice, t.direction)) {
      bestPrice = favour
    }
  }

  // Gröber als die Haltedauer? Dann steckt in der Messung Fremdbewegung. Ein
  // Fenster aus genau einer Kerze ist immer verdächtig: es IST die Kerze, die
  // Ein- und Ausstieg zugleich enthält.
  const holdSec = t.toSec - t.fromSec
  const candleSec = window.length > 1 ? window[1].time - window[0].time : Infinity
  const coarse = window.length <= 1 || candleSec > holdSec

  return {
    measured: true,
    maeR: favourable(worstPrice, t.entryPrice, t.direction) / t.riskDistance,
    mfeR: favourable(bestPrice, t.entryPrice, t.direction) / t.riskDistance,
    worstPrice,
    bestPrice,
    candlesUsed: window.length,
    coarse,
  }
}

/**
 * Ein von Hand nachgetragenes Extrem in einen Lauf übersetzen.
 *
 * Eingetragen werden **Kurse** — „wie tief lief es" liest man am Chart ab. Das
 * R ergibt sich daraus zwingend aus Einstieg und Stopdistanz; eine frei
 * getippte R-Zahl wäre eine Behauptung ohne Bezug. Fehlt eine Seite, gilt sie
 * als „nicht weiter gelaufen als der Einstieg" (0 R) statt als erfundener Wert.
 */
export function manualExcursionRun(t: ExcursionInput, manual: ManualExcursion): ExcursionRun {
  if (!Number.isFinite(t.riskDistance) || t.riskDistance <= 0) return fail('kein_risiko')

  const worstPrice = manual.worstPrice ?? t.entryPrice
  const bestPrice = manual.bestPrice ?? t.entryPrice
  // Ein Nachtrag darf nicht das Vorzeichen drehen: was in die falsche Richtung
  // getippt wurde, wird auf „nicht gelaufen" gekappt statt still umgedeutet.
  const maeR = Math.min(0, favourable(worstPrice, t.entryPrice, t.direction) / t.riskDistance)
  const mfeR = Math.max(0, favourable(bestPrice, t.entryPrice, t.direction) / t.riskDistance)

  return {
    measured: true,
    maeR,
    mfeR,
    worstPrice,
    bestPrice,
    candlesUsed: 0,
    coarse: false,
  }
}

/**
 * Messung oder Nachtrag — wer gewinnt?
 *
 * Vorrang hat die Messung, genau wie beim Bot-Zwilling. **Eine Ausnahme:** eine
 * `coarse`-Messung misst nicht das Haltefenster, sondern eine Kerze, die darüber
 * hinausragt. Sie ist damit keine Messung dieses Trades und darf von einer
 * Handeingabe überstimmt werden. Ohne Nachtrag bleibt sie stehen — gekennzeichnet.
 */
export function resolveRun(
  t: ExcursionInput,
  measured: ExcursionRun,
  manual: ManualExcursion | null,
): { run: ExcursionRun; source: ExcursionSource } {
  const hasManual = manual != null && (manual.worstPrice != null || manual.bestPrice != null)
  if (!hasManual) return { run: measured, source: 'kurse' }

  const measurementCounts = measured.measured && !measured.coarse
  if (measurementCounts) return { run: measured, source: 'kurse' }

  return { run: manualExcursionRun(t, manual), source: 'nachgetragen' }
}

function bucket(
  key: ExcursionBucket['key'],
  label: string,
  entries: readonly ExcursionEntry[],
  minGroupSize: number,
): ExcursionBucket {
  const runs = entries
    .map((e) => e.run)
    .filter((r): r is Extract<ExcursionRun, { measured: true }> => r.measured)
  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0

  return {
    key,
    label,
    trades: runs.length,
    avgMae: avg(runs.map((r) => r.maeR)),
    avgMfe: avg(runs.map((r) => r.mfeR)),
    avgExitR: avg(entries.filter((e) => e.run.measured).map((e) => e.realR)),
    worstMae: runs.length ? Math.min(...runs.map((r) => r.maeR)) : 0,
    enough: runs.length >= minGroupSize,
  }
}

/**
 * Die Auswertung über alle Trades.
 *
 * Getrennt nach **Gewinnern und Verlierern**, weil die beiden Zeilen zwei
 * verschiedene Fragen beantworten: der Gegenlauf der Gewinner sagt etwas über
 * die Stopweite (wie viel Luft brauchte der Trade, der am Ende aufging?), der
 * Mitlauf der Gewinner gegen den echten Ausstieg etwas über die Zielsetzung.
 * Die Verlierer stehen als Gegenprobe daneben.
 */
export function aggregateExcursion(
  entries: readonly ExcursionEntry[],
  minGroupSize: number = MIN_EXCURSION_TRADES,
): ExcursionStats {
  const winners = entries.filter((e) => e.won)
  const losers = entries.filter((e) => !e.won)

  const buckets = [
    bucket('gewinner', 'Gewinner', winners, minGroupSize),
    bucket('verlierer', 'Verlierer', losers, minGroupSize),
    bucket('gesamt', 'alle Trades', entries, minGroupSize),
  ]

  const measured = entries.filter((e) => e.run.measured)
  const gapCounts = new Map<ExcursionSkipReason, number>()
  for (const e of entries) {
    if (!e.run.measured) gapCounts.set(e.run.reason, (gapCounts.get(e.run.reason) ?? 0) + 1)
  }

  const win = buckets[0]
  const observations: ExcursionObservation[] = []
  if (win.enough) {
    // „Deine Gewinner liefen bis X, ausgestiegen bist du bei Y" — nur, wenn der
    // Abstand überhaupt der Rede wert ist (ein Zehntel R ist Rauschen).
    const zielLuft = win.avgMfe - win.avgExitR
    if (zielLuft >= 0.25) observations.push({ kind: 'ziele', gapR: zielLuft })
    // Der Gegenlauf der GEWINNER ist das Maß für die Stopweite: diese Trades
    // gingen am Ende auf, der Stop hätte sie also nur unnötig beendet.
    if (win.avgMae <= -0.5) observations.push({ kind: 'stops', gapR: Math.abs(win.avgMae) })
  }

  return {
    minGroupSize,
    buckets,
    coverage: {
      decided: entries.length,
      measured: measured.length,
      coarse: entries.filter((e) => e.run.measured && e.run.coarse).length,
      manual: entries.filter((e) => e.source === 'nachgetragen').length,
      gaps: [...gapCounts.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
    observations,
    resolutions: [...new Set(entries.map((e) => e.resolution).filter((r): r is string => !!r))],
  }
}

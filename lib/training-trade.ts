/**
 * Geübte Trades innerhalb einer Replay-Sitzung — rein und testbar.
 *
 * WARUM DAS MODELL SICH GEÄNDERT HAT
 * Bis hier war eine Übung: eine These, einmal aufdecken, eine Bewertung. Das
 * misst die Analyse, aber nicht das Handeln — im Markt trifft man nicht eine
 * Entscheidung, sondern eine Folge davon. Eine Sitzung ist deshalb jetzt ein
 * Replay-Durchlauf, in dem nacheinander **mehrere** Trades geplant, begleitet
 * und gemessen werden. Gezählt wird der Trade, nicht die Sitzung: Zehn Trades
 * in einer Sitzung sind zehn Entscheidungen.
 *
 * WAS SICH NICHT GEÄNDERT HAT — und nicht ändern darf
 * Die These steht **vor** dem Aufdecken fest (`committedAt`), und der Replay
 * gibt vorher keine Kerze frei. Ohne das misst der Trainer nichts.
 *
 * MESSEN STATT SCHÄTZEN
 * Ob Stop oder Ziel zuerst kam, rechnet `measureOutcome` aus den Kerzen —
 * nicht der Nutzer nach dem Aufdecken. Die Trefferentscheidung kommt aus
 * `candleReachesLevel` (`lib/alerts.ts`), derselben Quelle, die auch der
 * Bot-Zwilling und die Kurs-Alerts benutzen. Zwei Meinungen darüber, wann ein
 * Level erreicht ist, wären zwei Wahrheiten.
 */

import { candleReachesLevel } from './alerts'
import type { Candle } from './market-data/types'
import type { TrainingDirection, TrainingMode, TrainingRating } from './training'

/** Höchstens so viele Trades je Sitzung — darüber ist es kein Üben mehr. */
export const MAX_SESSION_TRADES = 20

// ---------------------------------------------------------------------------
// Haltepunkte
// ---------------------------------------------------------------------------

/** Wie der Replay anhält. Wird beim Anlegen der Sitzung gewählt. */
export type StopMode =
  /** Alle N Kerzen von selbst — man wird zum Hinsehen gezwungen. */
  | 'auto'
  /** Nur auf Knopfdruck — wer den Ablauf kennt, will nicht angehalten werden. */
  | 'manuell'

export const STOP_MODES: { id: StopMode; label: string; hint: string }[] = [
  {
    id: 'auto',
    label: 'Automatisch anhalten',
    hint: 'Der Replay hält von selbst an und fragt, ob du ein Setup siehst.',
  },
  {
    id: 'manuell',
    label: 'Ich halte selbst an',
    hint: 'Der Replay läuft durch, bis du Pause drückst.',
  },
]

export function isStopMode(v: unknown): v is StopMode {
  return v === 'auto' || v === 'manuell'
}

/** Voreinstellung des Abstands zwischen zwei Haltepunkten, in Kerzen. */
export const DEFAULT_STOP_EVERY = 10
export const MIN_STOP_EVERY = 3
export const MAX_STOP_EVERY = 100

export function clampStopEvery(v: unknown): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_STOP_EVERY
  return Math.min(MAX_STOP_EVERY, Math.max(MIN_STOP_EVERY, n))
}

/**
 * Bei welcher Anzahl sichtbarer Kerzen hält der Replay das nächste Mal an?
 *
 * Gezählt wird ab dem Startpunkt der Übung, nicht ab der ersten Kerze — der
 * Abstand soll sich auf das beziehen, was seit dem Aufdecken passiert ist.
 * `null` heißt: kein automatischer Halt (manueller Modus oder Ende erreicht).
 */
export function nextStopAt(
  visible: number,
  startIndex: number,
  total: number,
  mode: StopMode,
  every: number,
): number | null {
  if (mode !== 'auto') return null
  const schritt = clampStopEvery(every)
  if (visible >= total) return null
  const seit = Math.max(0, visible - startIndex)
  const ziel = startIndex + (Math.floor(seit / schritt) + 1) * schritt
  return Math.min(ziel, total)
}

/** Was an einem Haltepunkt entschieden wurde. */
export type CheckpointDecision =
  /** Kein Trade offen: hier ist kein Setup — weiterlaufen. */
  | 'kein_setup'
  /** Ein offener Trade: die These trägt weiter. */
  | 'haelt'
  /** Ein offener Trade: die Lage hat gedreht. */
  | 'gedreht'
  /** Ein offener Trade: hier wäre ich ausgestiegen. */
  | 'raus'

export const CHECKPOINT_DECISIONS: {
  id: CheckpointDecision
  label: string
  hint: string
  /** Braucht diese Entscheidung einen offenen Trade? */
  needsTrade: boolean
}[] = [
  {
    id: 'kein_setup',
    label: 'Kein Setup',
    hint: 'Hier ist nichts zu handeln — weiterlaufen lassen.',
    needsTrade: false,
  },
  {
    id: 'haelt',
    label: 'These hält',
    hint: 'Der Plan steht unverändert.',
    needsTrade: true,
  },
  {
    id: 'gedreht',
    label: 'These gedreht',
    hint: 'Die Lage spricht jetzt gegen den Plan.',
    needsTrade: true,
  },
  {
    id: 'raus',
    label: 'Ich wäre raus',
    hint: 'Hier hätte ich die Position verlassen — vor Stop und Ziel.',
    needsTrade: true,
  },
]

export function isCheckpointDecision(v: unknown): v is CheckpointDecision {
  return v === 'kein_setup' || v === 'haelt' || v === 'gedreht' || v === 'raus'
}

// ---------------------------------------------------------------------------
// Die These eines geübten Trades
// ---------------------------------------------------------------------------

/**
 * Welches Level gerade aus dem Chart aufgenommen wird.
 *
 * Steht hier und nicht in der Komponente: Chart, Formular und Arbeitsplatz
 * müssen sich darüber einig sein, worauf der nächste Klick geht.
 */
export type PickField = 'entry' | 'stop' | 'target'

export const PICK_LABELS: Record<PickField, string> = {
  entry: 'Einstieg',
  stop: 'Stop',
  target: 'Ziel',
}

/** Was das Formular liefert, bevor irgendetwas geprüft wurde. */
export interface TradeDraft {
  direction: TrainingDirection | null
  entryPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  elliottCount: string | null
  invalidation: number | null
  thesisNote: string | null
  setupTags: string[]
}

/**
 * Prüft eine These und liefert die Mängel im Klartext (leer = in Ordnung).
 *
 * Einstieg, Stop und Ziel sind **Pflicht**, sobald eine Richtung gewählt ist.
 * Nicht aus Formstrenge: Ohne sie kann `measureOutcome` nichts messen, und die
 * Bewertung fiele auf das eigene Gefühl nach dem Aufdecken zurück — genau die
 * Selbsttäuschung, gegen die dieser Trainer gebaut ist. Es ist dieselbe Regel
 * wie im Ernstfall: Risiko steht vor dem Einstieg fest.
 *
 * „Kein Setup" ist ausdrücklich erlaubt und braucht keine Marken — sich bewusst
 * gegen einen Trade zu entscheiden ist eine Leistung, keine Lücke.
 */
export function validateTradeDraft(draft: TradeDraft, mode: TrainingMode): string[] {
  const fehler: string[] = []

  if (draft.direction == null) {
    fehler.push('Richtung fehlt.')
    return fehler
  }
  if (draft.direction === 'keine') return fehler

  const { entryPrice: entry, stopLoss: stop, takeProfit: ziel } = draft
  const zahl = (v: number | null): v is number => v != null && Number.isFinite(v) && v > 0

  if (!zahl(entry)) fehler.push('Einstieg fehlt.')
  if (!zahl(stop)) fehler.push('Stop fehlt.')
  if (!zahl(ziel)) fehler.push('Ziel fehlt.')
  if (!zahl(entry) || !zahl(stop) || !zahl(ziel)) return fehler

  if (stop === entry) {
    fehler.push('Stop und Einstieg sind gleich — damit ist kein Risiko definiert.')
    return fehler
  }

  // Die Seiten müssen zur Richtung passen, sonst misst man etwas anderes, als
  // man geplant hat.
  if (draft.direction === 'long') {
    if (stop >= entry) fehler.push('Bei Long muss der Stop unter dem Einstieg liegen.')
    if (ziel <= entry) fehler.push('Bei Long muss das Ziel über dem Einstieg liegen.')
  } else {
    if (stop <= entry) fehler.push('Bei Short muss der Stop über dem Einstieg liegen.')
    if (ziel >= entry) fehler.push('Bei Short muss das Ziel unter dem Einstieg liegen.')
  }

  if (mode === 'elliott') {
    if (!draft.elliottCount?.trim()) fehler.push('Wellenzählung fehlt.')
    if (!zahl(draft.invalidation)) fehler.push('Invalidation fehlt.')
  }

  return fehler
}

// ---------------------------------------------------------------------------
// Messen
// ---------------------------------------------------------------------------

/** Wie der geübte Trade ausgegangen ist. */
export type TradeOutcome =
  | 'ziel'
  | 'stop'
  /** Bis zum Ende des Ausschnitts wurde weder Stop noch Ziel berührt. */
  | 'offen'

export interface OutcomeMeasurement {
  outcome: TradeOutcome
  /** Der Kurs, zu dem abgerechnet wurde. */
  exitPrice: number
  /** Zeit der Kerze, in der es entschieden wurde (Unix-Sekunden). */
  atTime: number
  /** Ergebnis in R — Gewinn/Verlust gemessen am geplanten Risiko. */
  rMultiple: number
  /**
   * Stop UND Ziel lagen in derselben Kerze. Dann gilt der Stop (konservativ,
   * wie beim Bot-Zwilling): Aus einer Kerze geht nicht hervor, was zuerst kam,
   * und die für einen ungünstige Annahme ist die einzige, die nicht schönt.
   */
  ambiguous: boolean
}

/**
 * Das Ergebnis eines geübten Trades aus den Kerzen bestimmen.
 *
 * Gemessen wird ab der Kerze, die auf den Einstieg folgt: Die angebrochene
 * Einstiegskerze enthält auch Bewegung von **vor** dem Einstieg — sie
 * mitzuzählen würde Stops auslösen, die es nie gab. Dieselbe Abgrenzung wie
 * bei MAE/MFE.
 *
 * `null` heißt: nicht messbar (keine Kerzen nach dem Einstieg, unbrauchbare
 * Marken). Der Aufrufer weist das aus, statt eine Null zu erfinden.
 */
export function measureOutcome(
  trade: { direction: TrainingDirection; entryPrice: number; stopLoss: number; takeProfit: number },
  candles: readonly Candle[],
  fromSec: number,
): OutcomeMeasurement | null {
  const { direction, entryPrice: entry, stopLoss: stop, takeProfit: ziel } = trade
  if (direction === 'keine') return null
  if (![entry, stop, ziel, fromSec].every((n) => Number.isFinite(n))) return null

  const risiko = Math.abs(entry - stop)
  if (risiko <= 0) return null

  const fenster = candles.filter((c) => c.time > fromSec)
  if (fenster.length === 0) return null

  const stopRichtung = direction === 'short' ? 'above' : 'below'
  const zielRichtung = direction === 'short' ? 'below' : 'above'

  /** Gewinn je Einheit → R. Bei Short zählt die Bewegung nach unten positiv. */
  const inR = (kurs: number) =>
    ((direction === 'short' ? entry - kurs : kurs - entry) / risiko)

  for (const c of fenster) {
    const trifftStop = candleReachesLevel(stopRichtung, stop, c)
    const trifftZiel = candleReachesLevel(zielRichtung, ziel, c)
    if (trifftStop) {
      return {
        outcome: 'stop',
        exitPrice: stop,
        atTime: c.time,
        rMultiple: inR(stop),
        ambiguous: trifftZiel,
      }
    }
    if (trifftZiel) {
      return {
        outcome: 'ziel',
        exitPrice: ziel,
        atTime: c.time,
        rMultiple: inR(ziel),
        ambiguous: false,
      }
    }
  }

  const letzte = fenster[fenster.length - 1]
  return {
    outcome: 'offen',
    exitPrice: letzte.close,
    atTime: letzte.time,
    rMultiple: inR(letzte.close),
    ambiguous: false,
  }
}

/**
 * Das **gemessene** Ergebnis in eine Bewertung übersetzen — als Vorschlag.
 *
 * Der Vorschlag ersetzt das eigene Urteil nicht: Ein Trade kann das Ziel
 * erreichen und die Zählung trotzdem falsch gewesen sein. Deshalb wird hier
 * vorbelegt und nicht entschieden.
 */
export function suggestRating(outcome: TradeOutcome): 'korrekt' | 'teilweise' | 'falsch' {
  if (outcome === 'ziel') return 'korrekt'
  if (outcome === 'stop') return 'falsch'
  return 'teilweise'
}

/**
 * Ein geübter Trade, wie die Oberfläche ihn braucht.
 *
 * Steht hier und NICHT in `app/actions/training-trades.ts`: Eine
 * `'use server'`-Datei darf ausschließlich async Funktionen exportieren —
 * Turbopack behandelt sonst auch einen reinen Typ-Export als Server Action und
 * der Build bricht.
 */
export interface TrainingTradeView {
  id: number
  seq: number
  direction: TrainingDirection
  entryPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  elliottCount: string | null
  invalidation: number | null
  thesisNote: string | null
  setupTags: string[]
  entryCandleTime: number | null
  committedAt: Date
  /** Gemessen, nicht eingegeben. `null` = läuft noch. */
  outcome: TradeOutcome | null
  outcomeCandleTime: number | null
  exitPrice: number | null
  rMultiple: number | null
  ambiguous: boolean
  /** Die eigene Einordnung — unabhängig vom gemessenen Ergebnis. */
  rating: TrainingRating | null
  errorTags: string[]
  note: string | null
  ratedAt: Date | null
}

// ---------------------------------------------------------------------------
// Bilanz einer Sitzung
// ---------------------------------------------------------------------------

export interface SessionSummary {
  /** Trades mit gemessenem oder eingeordnetem Ergebnis. */
  entschieden: number
  ziel: number
  stop: number
  offen: number
  /** Bewusste Enthaltungen — sie zählen NICHT in die Trefferquote. */
  keinSetup: number
  /** Summe in R über die entschiedenen Trades. */
  summeR: number
  /** Trefferquote in Prozent (Ziel / entschieden) — `null`, wenn nichts entschieden ist. */
  quote: number | null
}

/**
 * Was das eigene Eingreifen gekostet hätte.
 *
 * Das ist die härteste und nützlichste Frage, die der Trainer beantworten kann
 * — und sie geht nur, weil an jedem Haltepunkt festgehalten wird, was man
 * *gewollt* hätte, während der Plan mechanisch weiterlief. Wer an einem
 * Haltepunkt „ich wäre raus" gesagt hat und der Trade lief danach ins Ziel, hat
 * genau den Fehler gemacht, gegen den diese ganze App gebaut ist: Er ist aus
 * einem plan-konformen Trade ausgestiegen, weil es sich unangenehm anfühlte.
 *
 * Derselbe Gedanke wie beim Bot-Zwilling der echten Trades — hier aber ohne
 * Geld, mit beliebig vielen Wiederholungen und sofortiger Rückmeldung.
 *
 * Die Zahl ist bewusst nur die Summe der Fälle, in denen es messbar ist: Ein
 * „raus" bei einem Trade, der ohnehin in den Stop lief, kostet nichts und wird
 * nicht mitgezählt.
 */
export interface InterventionCost {
  /** Wie oft an einem Haltepunkt „ich wäre raus" gesagt wurde. */
  ausstiege: number
  /** Davon: Trades, die danach trotzdem ihr Ziel erreichten. */
  waerenAufgegangen: number
  /** Was diese Trades zusammen gebracht haben (in R) — der entgangene Teil. */
  entgangenR: number
  /** Trades, bei denen der Ausstieg richtig gewesen wäre (liefen in den Stop). */
  richtigGewesen: number
}

export function computeInterventionCost(
  trades: readonly { id: number; outcome: TradeOutcome | null; rMultiple: number | null }[],
  checkpoints: readonly { tradeId: number | null; decision: CheckpointDecision }[],
): InterventionCost {
  const out: InterventionCost = {
    ausstiege: 0,
    waerenAufgegangen: 0,
    entgangenR: 0,
    richtigGewesen: 0,
  }
  const byId = new Map(trades.map((t) => [t.id, t]))
  // Je Trade zählt nur EIN Ausstiegswunsch — wer dreimal an derselben Position
  // aussteigen will, ist trotzdem einmal ausgestiegen.
  const gezaehlt = new Set<number>()

  for (const c of checkpoints) {
    if (c.decision !== 'raus' || c.tradeId == null) continue
    if (gezaehlt.has(c.tradeId)) continue
    const t = byId.get(c.tradeId)
    if (!t || t.outcome == null) continue
    gezaehlt.add(c.tradeId)
    out.ausstiege++
    if (t.outcome === 'ziel') {
      out.waerenAufgegangen++
      if (t.rMultiple != null && Number.isFinite(t.rMultiple)) out.entgangenR += t.rMultiple
    } else if (t.outcome === 'stop') {
      out.richtigGewesen++
    }
  }
  return out
}

/**
 * Die Bilanz einer Sitzung — wie ein Handelstag im Zeitraffer.
 *
 * „Kein Setup" steht bewusst daneben statt darin: Eine Enthaltung ist kein
 * verlorener Trade. Würde sie als Fehlschlag zählen, wäre die sicherste
 * Strategie, immer irgendetwas zu handeln — das Gegenteil dessen, was hier
 * geübt werden soll.
 */
export function summarizeSession(
  trades: readonly { outcome: TradeOutcome | null; rMultiple: number | null }[],
): SessionSummary {
  const out: SessionSummary = {
    entschieden: 0,
    ziel: 0,
    stop: 0,
    offen: 0,
    keinSetup: 0,
    summeR: 0,
    quote: null,
  }

  for (const t of trades) {
    if (t.outcome == null) {
      out.keinSetup++
      continue
    }
    out.entschieden++
    if (t.outcome === 'ziel') out.ziel++
    else if (t.outcome === 'stop') out.stop++
    else out.offen++
    if (t.rMultiple != null && Number.isFinite(t.rMultiple)) out.summeR += t.rMultiple
  }

  if (out.entschieden > 0) out.quote = (out.ziel / out.entschieden) * 100
  return out
}

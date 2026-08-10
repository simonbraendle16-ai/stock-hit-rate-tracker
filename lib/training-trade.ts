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

import { candleReachesLevel, directionForLevel } from './alerts'
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
  // Eine Stufe zu 100 % ist derselbe Fall — gerechnet wird deshalb an genau
  // einer Stelle. Zwei Kerzenläufe wären zwei Gelegenheiten, verschieden zu
  // entscheiden, wann ein Level als berührt gilt.
  return measureStagedOutcome(
    { ...trade, targets: [{ price: trade.takeProfit, sharePct: 100 }], stopAufEinstand: false },
    candles,
    fromSec,
  )
}

/** Eine Zielstufe der geübten Order. */
export interface StagedTarget {
  price: number
  /** Anteil der ANFANGSposition auf dieser Stufe (0..100]. */
  sharePct: number
}

/** Ein abgerechneter Teilausstieg. */
export interface StagedExit {
  /** 1-basierte Stufe; 0 steht für den Rest am Stop bzw. am Ende. */
  stufe: number
  preis: number
  /** Tatsächlich abgerechneter Anteil in Prozent. */
  anteil: number
  atTime: number
  /** Gewichteter R-Beitrag dieses Teils. */
  r: number
}

export interface StagedMeasurement extends OutcomeMeasurement {
  /** Höchste erreichte Zielstufe (0 = keine). */
  reachedTarget: number
  exits: StagedExit[]
}

/**
 * Das Ergebnis einer geübten Order mit Teilzielen aus den Kerzen bestimmen.
 *
 * Die Regeln, alle vom Nutzer so entschieden:
 *
 *  - **Stufen der Reihe nach.** Jede Stufe nimmt ihren Anteil der ANFANGS-
 *    position; die Summe darf unter 100 % bleiben, der Rest läuft weiter.
 *  - **`stopAufEinstand`**: Nach der ersten abgerechneten Stufe wandert der Stop
 *    auf den Einstieg. Das schmeichelt der Statistik gegenüber dem ursprünglich
 *    geplanten Risiko — deshalb stehen die Teilausstiege einzeln in `exits`,
 *    damit man sieht, woraus das R entstanden ist.
 *  - **Stop und Ziel in derselben Kerze → der Stop gilt.** Unverändert
 *    konservativ: Aus einer Kerze geht nicht hervor, was zuerst kam.
 *  - **`outcome` ist 'ziel', sobald irgendeine Stufe lief.** Wie weit es
 *    wirklich kam, sagt `reachedTarget`.
 *
 * `null` heißt nicht messbar — der Aufrufer weist das aus, statt eine Null zu
 * erfinden.
 */
export function measureStagedOutcome(
  trade: {
    direction: TrainingDirection
    entryPrice: number
    stopLoss: number
    targets: readonly StagedTarget[]
    /** Stop nach der ersten Stufe auf den Einstieg ziehen. */
    stopAufEinstand: boolean
  },
  candles: readonly Candle[],
  fromSec: number,
): StagedMeasurement | null {
  const { direction, entryPrice: entry, stopLoss: stop } = trade
  if (direction === 'keine') return null
  if (![entry, stop, fromSec].every((n) => Number.isFinite(n))) return null

  const risiko = Math.abs(entry - stop)
  if (risiko <= 0) return null

  const stufen = trade.targets
    .filter((t) => Number.isFinite(t.price) && t.sharePct > 0)
    // Nach Abstand zum Einstieg: Stufe 1 ist die nächstliegende. Die Reihenfolge
    // ist die Abrechnungsreihenfolge und darf nicht von der Eingabe abhängen.
    .map((t) => ({ ...t }))
    .sort((a, b) =>
      direction === 'short' ? b.price - a.price : a.price - b.price,
    )
  if (stufen.length === 0) return null

  const fenster = candles.filter((c) => c.time > fromSec)
  if (fenster.length === 0) return null

  const stopRichtung = direction === 'short' ? 'above' : 'below'
  const zielRichtung = direction === 'short' ? 'below' : 'above'

  /** Gewinn je Einheit → R. Bei Short zählt die Bewegung nach unten positiv. */
  const inR = (kurs: number) => (direction === 'short' ? entry - kurs : kurs - entry) / risiko

  let stopAktuell = stop
  let rest = 100
  let summeR = 0
  let reached = 0
  const exits: StagedExit[] = []

  const fertig = (
    outcome: TradeOutcome,
    preis: number,
    atTime: number,
    ambiguous: boolean,
  ): StagedMeasurement => ({
    outcome,
    exitPrice: preis,
    atTime,
    rMultiple: summeR,
    ambiguous,
    reachedTarget: reached,
    exits,
  })

  for (const c of fenster) {
    const trifftStop = candleReachesLevel(stopRichtung, stopAktuell, c)
    const offeneStufen = stufen.slice(reached)
    const trifftIrgendeinZiel = offeneStufen.some((t) =>
      candleReachesLevel(zielRichtung, t.price, c),
    )

    if (trifftStop) {
      const anteil = rest
      const r = (anteil / 100) * inR(stopAktuell)
      summeR += r
      exits.push({ stufe: 0, preis: stopAktuell, anteil, atTime: c.time, r })
      // Lief vorher schon eine Stufe, war es kein reiner Fehlschlag — nach der
      // Absprache zählt das als Treffer, und `reachedTarget` hält fest, wie weit.
      return fertig(reached > 0 ? 'ziel' : 'stop', stopAktuell, c.time, trifftIrgendeinZiel)
    }

    for (const t of offeneStufen) {
      if (!candleReachesLevel(zielRichtung, t.price, c)) break
      const anteil = Math.min(t.sharePct, rest)
      if (anteil <= 0) break
      const r = (anteil / 100) * inR(t.price)
      summeR += r
      rest -= anteil
      reached += 1
      exits.push({ stufe: reached, preis: t.price, anteil, atTime: c.time, r })
      if (trade.stopAufEinstand) stopAktuell = entry
      if (rest <= 0) return fertig('ziel', t.price, c.time, false)
    }
  }

  // Nichts mehr getroffen: Der Rest wird zum letzten Kurs bewertet.
  const letzte = fenster[fenster.length - 1]
  if (rest > 0) {
    const r = (rest / 100) * inR(letzte.close)
    summeR += r
    exits.push({ stufe: 0, preis: letzte.close, anteil: rest, atTime: letzte.time, r })
  }
  return fertig(reached > 0 ? 'ziel' : 'offen', letzte.close, letzte.time, false)
}

/** Wie es einer liegenden Order ergangen ist. */
export type OrderStatus =
  | 'liegt'
  | 'ausgeloest'
  | 'gestrichen'
  | 'nicht_ausgeloest'
  | 'invalidiert'

export const ORDER_STATUS: OrderStatus[] = [
  'liegt',
  'ausgeloest',
  'gestrichen',
  'nicht_ausgeloest',
  'invalidiert',
]

/** Beschriftung für die Oberfläche — an einer Stelle, damit sie überall gleich heißt. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  liegt: 'liegt im Markt',
  ausgeloest: 'ausgelöst',
  gestrichen: 'gestrichen',
  nicht_ausgeloest: 'nicht ausgelöst',
  invalidiert: 'invalidiert',
}

export function istOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === 'string' && (ORDER_STATUS as string[]).includes(v)
}

export interface EntryFill {
  status: 'ausgeloest' | 'nicht_ausgeloest' | 'invalidiert'
  /** Kerze der Auslösung; `null`, wenn sie nie kam. */
  atTime: number | null
}

/**
 * Wurde der geplante Einstieg überhaupt erreicht?
 *
 * Bis zu dieser Ausbaustufe galt er im Moment des Festschreibens als gefüllt —
 * damit gingen Trades in die Quote ein, die es nie gegeben hat. Die Prüfung ist
 * dieselbe wie bei echten Trades (`simulateMissedTrade`, `lib/bot-twin.ts`):
 * Aus welcher Richtung der Kurs auf den Einstieg zuläuft, entscheidet
 * `directionForLevel` gegen den letzten sichtbaren Schlusskurs.
 *
 * **Einstieg und Invalidierung in derselben Kerze → der Einstieg gilt.** Das ist
 * die unbequeme Annahme: Eine für ungültig erklärte Order wäre gar kein Trade
 * und fiele aus der Quote — die bequeme Lesart würde also einen wahrscheinlichen
 * Verlust wegdefinieren. Dieselbe Haltung wie bei „Stop schlägt Ziel".
 */
export function findEntryFill(
  order: {
    direction: TrainingDirection
    entryPrice: number
    /** Preisniveau, das die Order tötet, bevor sie ausgelöst wird. */
    orderInvalidation?: number | null
  },
  candles: readonly Candle[],
  fromSec: number,
): EntryFill | null {
  const { entryPrice: entry } = order
  if (order.direction === 'keine') return null
  if (![entry, fromSec].every((n) => Number.isFinite(n))) return null

  const fenster = candles.filter((c) => c.time > fromSec)
  if (fenster.length === 0) return null

  // Bezug ist der Schlusskurs der letzten SICHTBAREN Kerze — der Kurs, zu dem
  // die Order gelegt wurde. Fehlt sie (Ausschnitt fängt später an), tut es die
  // erste Kerze danach.
  const beiAuftrag = candles.find((c) => c.time === fromSec)
  const referenz = beiAuftrag ? beiAuftrag.close : fenster[0].close

  const einstiegRichtung = directionForLevel(entry, referenz)
  // Kein Abstand zum Kurs: Die Order liegt bereits im Markt und ist sofort drin.
  if (einstiegRichtung == null) {
    return { status: 'ausgeloest', atTime: fenster[0].time }
  }

  const inv = order.orderInvalidation
  const invRichtung =
    inv != null && Number.isFinite(inv) ? directionForLevel(inv, referenz) : null

  for (const c of fenster) {
    if (candleReachesLevel(einstiegRichtung, entry, c)) {
      return { status: 'ausgeloest', atTime: c.time }
    }
    if (inv != null && invRichtung != null && candleReachesLevel(invRichtung, inv, c)) {
      return { status: 'invalidiert', atTime: c.time }
    }
  }

  return { status: 'nicht_ausgeloest', atTime: null }
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
  // --- Ausbaustufe 3: die These liegt als Order im Markt ---
  orderStatus: OrderStatus
  /** Kerze, in der der Einstieg berührt wurde. `null`, solange sie liegt. */
  filledCandleTime: number | null
  orderInvalidation: number | null
  /** Höchste erreichte Zielstufe (0 = keine). */
  reachedTarget: number
  /** Die geplanten Teilziele, aufsteigend nach Abstand zum Einstieg. */
  targets: { price: number; sharePct: number }[]
}

/** Ob eine Order noch auf ihre Auslösung wartet. */
export function istLiegend(t: { orderStatus: OrderStatus }): boolean {
  return t.orderStatus === 'liegt'
}

/**
 * Zählt dieser Trade in die Trefferquote?
 *
 * Gestrichene, nie ausgelöste und invalidierte Orders waren **keine Trades** —
 * sie gehören ausgewiesen, aber nicht in die Quote. Genau daran hing der
 * Messfehler dieser Ausbaustufe.
 */
export function zaehltInQuote(t: { orderStatus: OrderStatus; direction: TrainingDirection }): boolean {
  return t.direction !== 'keine' && t.orderStatus === 'ausgeloest'
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
  /**
   * Orders, die nie zu einem Trade wurden: gestrichen, nie ausgelöst oder vor
   * dem Einstieg invalidiert. Ausgewiesen, aber **nicht** in der Quote — sie
   * waren keine Trades. Genau hier saß der Messfehler: Vor Ausbaustufe 3 galt
   * jede geplante Order als ausgeführt.
   *
   * Die Summe der drei Zahlen darunter.
   */
  nichtGehandelt: number
  /**
   * Warum es kein Trade wurde — drei verschiedene Antworten, die nicht in eine
   * Zahl gehören:
   *
   * - `gestrichen`: **du** hast zurückgezogen. Das ist eine Entscheidung und
   *   gehört bemerkt — wer regelmäßig streicht, sobald es unbequem wird,
   *   handelt seine Emotion, nicht seinen Plan.
   * - `nichtAusgeloest`: der Markt kam nicht. Kein Fehler, aber ein Hinweis auf
   *   zu weit entfernte Einstiege.
   * - `invalidiert`: die These fiel, bevor der Einstieg dran war. Das ist der
   *   Fall, in dem die Order genau das getan hat, wofür sie gedacht war.
   */
  gestrichen: number
  nichtAusgeloest: number
  invalidiert: number
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
  trades: readonly {
    outcome: TradeOutcome | null
    rMultiple: number | null
    /** Fehlt sie (Altbestand, Tests), gilt die Order als ausgeführt. */
    orderStatus?: OrderStatus
  }[],
): SessionSummary {
  const out: SessionSummary = {
    entschieden: 0,
    ziel: 0,
    stop: 0,
    offen: 0,
    keinSetup: 0,
    nichtGehandelt: 0,
    gestrichen: 0,
    nichtAusgeloest: 0,
    invalidiert: 0,
    summeR: 0,
    quote: null,
  }

  for (const t of trades) {
    // Eine Order, die nie ausgelöst hat, ist weder Treffer noch Fehlschlag —
    // und auch keine Enthaltung: Der Wille war da, der Markt kam nicht.
    // Getrennt gezählt, weil die drei Gründe verschiedene Lehren tragen; die
    // Summe steht daneben, damit die Quote unverändert davon frei bleibt.
    if (
      t.orderStatus === 'gestrichen' ||
      t.orderStatus === 'nicht_ausgeloest' ||
      t.orderStatus === 'invalidiert'
    ) {
      out.nichtGehandelt++
      if (t.orderStatus === 'gestrichen') out.gestrichen++
      else if (t.orderStatus === 'nicht_ausgeloest') out.nichtAusgeloest++
      else out.invalidiert++
      continue
    }
    // Eine noch liegende Order ist schlicht noch nichts.
    if (t.orderStatus === 'liegt') continue
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

/**
 * Wie weit eine Sitzung schon aufgedeckt war — als ZEIT der zuletzt gesehenen
 * Kerze.
 *
 * Der Fortschritt lag bis hierher nur im Browser. Ein F5 setzte die Sitzung
 * damit zurück vor die erste Entscheidung: Der Replay war wieder gesperrt, und
 * eine erneut gegebene Antwort „kein Setup" landete ein ZWEITES Mal in
 * `training_checkpoint`. Ausgerechnet die Zahl gegen das Überhandeln wurde so
 * durch einen Seitenneuladen nach oben verfälscht.
 *
 * Gerechnet wird über die Zeit, nicht über einen Index — aus demselben Grund
 * wie beim Startpunkt der Übung: Ein Index gilt nur in genau dem Kerzensatz,
 * in dem er entstand, und der Kerzenspeicher wächst.
 *
 * Genommen wird das MAXIMUM: Gesehen ist gesehen. Ein früherer Wert wäre
 * harmlos (man sieht noch einmal hin), ein späterer würde Zukunft aufdecken —
 * deshalb gehen hier ausschließlich Zeiten ein, die der Nutzer nachweislich
 * schon vor sich hatte.
 */
export function fortschrittZeit(zeiten: readonly (number | null | undefined)[]): number | null {
  let max: number | null = null
  for (const z of zeiten) {
    if (typeof z !== 'number' || !Number.isFinite(z)) continue
    if (max == null || z > max) max = z
  }
  return max
}

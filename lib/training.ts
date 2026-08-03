/**
 * Replay-Trainer — die reine Domänenlogik (Phase 3–5 des Trainer-Plans).
 *
 * Hier steht KEIN Datenbankzugriff und kein React. Die Server Actions in
 * `app/actions/training.ts` laden nur Zeilen und rufen hier hinein; die
 * Oberfläche liest dieselben Kataloge. Eine zweite Stelle, die entscheidet,
 * was eine gültige Bewertung ist, wäre eine zweite Wahrheit.
 *
 * Douglas-Leitplanke: Eine Übung wird VOR dem Aufdecken festgeschrieben
 * (`commit`) und ERST DANACH bewertet. Genau diese Reihenfolge macht aus dem
 * Zurückspulen eine Übung statt einer Bestätigung der eigenen Erinnerung.
 */

/** Woher die Übung kommt. */
export type TrainingMode =
  /** Selbst gewähltes Symbol, selbst gewählter Startpunkt. */
  | 'frei'
  /** Zufälliges Instrument aus der Watchlist, zufälliger Startpunkt, verdeckt. */
  | 'zufall'
  /** Wie `zufall`, aber mit Elliott-Fragen (Wellenzählung + Invalidation). */
  | 'elliott'

export const TRAINING_MODES: { id: TrainingMode; label: string; hint: string }[] = [
  {
    id: 'frei',
    label: 'Freie Übung',
    hint: 'Du wählst Symbol, Timeframe und Startpunkt selbst.',
  },
  {
    id: 'zufall',
    label: 'Zufallschart',
    hint: 'Instrument und Startpunkt werden gezogen — verdeckt bis zur Auflösung.',
  },
  {
    id: 'elliott',
    label: 'Elliott-Training',
    hint: 'Zufallschart plus Pflichtangaben zu Wellenzählung und Invalidation.',
  },
]

export function isTrainingMode(v: unknown): v is TrainingMode {
  return v === 'frei' || v === 'zufall' || v === 'elliott'
}

/** Ein verdeckter Modus zeigt Symbol und Datum erst nach der Bewertung. */
export function isBlindMode(mode: TrainingMode): boolean {
  return mode === 'zufall' || mode === 'elliott'
}

/** Nur im Elliott-Modus sind Wellenzählung und Invalidation Pflicht. */
export function requiresElliott(mode: TrainingMode): boolean {
  return mode === 'elliott'
}

// ---------------------------------------------------------------------------
// Bewertung
// ---------------------------------------------------------------------------

/** Die drei Stufen aus dem Plan — bewusst keine vierte. */
export type TrainingRating = 'korrekt' | 'teilweise' | 'falsch'

export const TRAINING_RATINGS: {
  id: TrainingRating
  label: string
  hint: string
}[] = [
  {
    id: 'korrekt',
    label: 'Korrekt',
    hint: 'Richtung und Struktur sind so gelaufen wie festgeschrieben.',
  },
  {
    id: 'teilweise',
    label: 'Teilweise korrekt',
    hint: 'Richtung stimmte, die Ausführung oder die Zählung nicht.',
  },
  {
    id: 'falsch',
    label: 'Falsch',
    hint: 'Der Markt hat die These widerlegt.',
  },
]

export function isTrainingRating(v: unknown): v is TrainingRating {
  return v === 'korrekt' || v === 'teilweise' || v === 'falsch'
}

/** Richtung der festgeschriebenen These. `keine` = bewusst kein Setup gesehen. */
export type TrainingDirection = 'long' | 'short' | 'keine'

export const TRAINING_DIRECTIONS: { id: TrainingDirection; label: string }[] = [
  { id: 'long', label: 'Long' },
  { id: 'short', label: 'Short' },
  { id: 'keine', label: 'Kein Setup' },
]

export function isTrainingDirection(v: unknown): v is TrainingDirection {
  return v === 'long' || v === 'short' || v === 'keine'
}

// ---------------------------------------------------------------------------
// Fehler-Katalog
// ---------------------------------------------------------------------------

/**
 * Anders als die Setup-Tags (frei benannt, weil Setups persönlich sind) ist der
 * Fehler-Katalog FEST. Nur so lässt sich über Monate zählen, welcher Fehler der
 * eigene Lieblingsfehler ist — genau die Frage aus Phase 5 des Plans
 * („häufigste Elliott-Fehler", „falsche Invalidierungen", „zu früher Einstieg",
 * „falsche Wellenzählung"). Frei getippte Fehler wären nach zwanzig Übungen
 * zwanzig Einzelfälle.
 */
export type TrainingErrorTag =
  | 'falsche_wellenzaehlung'
  | 'falsche_invalidierung'
  | 'zu_frueher_einstieg'
  | 'zu_spaeter_einstieg'
  | 'gegen_den_trend'
  | 'grad_verwechselt'
  | 'korrektur_als_impuls'
  | 'stop_zu_eng'
  | 'ziel_unrealistisch'
  | 'kein_fehler'

export const TRAINING_ERROR_TAGS: {
  id: TrainingErrorTag
  label: string
  /** Nur Elliott-spezifische Fehler tragen `elliott` — für die eigene Zeile in der Statistik. */
  elliott: boolean
}[] = [
  { id: 'falsche_wellenzaehlung', label: 'Falsche Wellenzählung', elliott: true },
  { id: 'falsche_invalidierung', label: 'Falsche Invalidation', elliott: true },
  { id: 'grad_verwechselt', label: 'Grad verwechselt', elliott: true },
  { id: 'korrektur_als_impuls', label: 'Korrektur als Impuls gelesen', elliott: true },
  { id: 'zu_frueher_einstieg', label: 'Zu früher Einstieg', elliott: false },
  { id: 'zu_spaeter_einstieg', label: 'Zu später Einstieg', elliott: false },
  { id: 'gegen_den_trend', label: 'Gegen den übergeordneten Trend', elliott: false },
  { id: 'stop_zu_eng', label: 'Stop zu eng', elliott: false },
  { id: 'ziel_unrealistisch', label: 'Ziel unrealistisch', elliott: false },
  { id: 'kein_fehler', label: 'Kein Fehler erkennbar', elliott: false },
]

const ERROR_TAG_IDS = new Set(TRAINING_ERROR_TAGS.map((t) => t.id))

export function trainingErrorLabel(id: string): string {
  return TRAINING_ERROR_TAGS.find((t) => t.id === id)?.label ?? id
}

/** Höchstens so viele Fehler je Übung — eine Liste aus zehn Häkchen zählt nichts. */
export const MAX_TRAINING_ERRORS = 4

/**
 * Fremde Eingaben auf den Katalog eindampfen: unbekannte Werte fliegen raus,
 * Dubletten auch, die Reihenfolge des Katalogs gewinnt (damit zwei gleiche
 * Auswahlen identisch gespeichert werden).
 */
export function sanitizeErrorTags(raw: unknown): TrainingErrorTag[] {
  if (!Array.isArray(raw)) return []
  const chosen = new Set<string>()
  for (const v of raw) {
    if (typeof v === 'string' && ERROR_TAG_IDS.has(v as TrainingErrorTag)) chosen.add(v)
  }
  // „Kein Fehler" schließt jede andere Angabe aus — sonst stünde beides da.
  if (chosen.has('kein_fehler') && chosen.size > 1) chosen.delete('kein_fehler')
  return TRAINING_ERROR_TAGS.filter((t) => chosen.has(t.id))
    .slice(0, MAX_TRAINING_ERRORS)
    .map((t) => t.id)
}

export function parseErrorTags(raw: string | null | undefined): TrainingErrorTag[] {
  if (!raw) return []
  try {
    return sanitizeErrorTags(JSON.parse(raw))
  } catch {
    return []
  }
}

export function serializeErrorTags(tags: unknown): string | null {
  const clean = sanitizeErrorTags(tags)
  return clean.length > 0 ? JSON.stringify(clean) : null
}

// ---------------------------------------------------------------------------
// Startpunkt
// ---------------------------------------------------------------------------

/** Unter so vielen Kerzen ist ein Replay sinnlos — es bliebe nichts zu verbergen. */
export const MIN_REPLAY_CANDLES = 60

/** So viele Kerzen bleiben mindestens sichtbar (Kontext für die Analyse). */
export const MIN_VISIBLE_CANDLES = 30

/** So viele Kerzen bleiben mindestens verborgen (sonst gäbe es nichts zu üben). */
export const MIN_HIDDEN_CANDLES = 15

/** Startpunkt der freien Übung: knapp zwei Drittel Vergangenheit. */
export const DEFAULT_START_FRACTION = 0.62

/**
 * Startpunkt aus einer Zufallszahl `r` (0 ≤ r < 1) — als reine Funktion, damit
 * sie testbar ist und der Aufrufer den Zufall stellt.
 *
 * Das Fenster liegt bewusst zwischen 35 % und 80 %: darunter fehlt der Kontext
 * für eine ehrliche Analyse, darüber bleibt zu wenig Zukunft zum Auflösen.
 */
export function randomStartIndex(total: number, r: number): number {
  const lo = Math.max(MIN_VISIBLE_CANDLES, Math.floor(total * 0.35))
  const hi = Math.min(total - MIN_HIDDEN_CANDLES, Math.floor(total * 0.8))
  if (hi <= lo) return Math.max(1, Math.min(total, lo))
  const span = hi - lo
  const clamped = Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0
  return lo + Math.floor(clamped * (span + 1))
}

/** Startpunkt der freien Übung, mit denselben Rändern wie der Zufallsstart. */
export function defaultStartIndex(total: number): number {
  const lo = Math.min(MIN_VISIBLE_CANDLES, total)
  const hi = Math.max(lo, total - MIN_HIDDEN_CANDLES)
  return Math.min(hi, Math.max(lo, Math.round(total * DEFAULT_START_FRACTION)))
}

// ---------------------------------------------------------------------------
// Zustand einer Übung
// ---------------------------------------------------------------------------

/**
 * Der Lebenslauf einer Übung. Er ist der Grund, warum die Übung überhaupt etwas
 * misst: Zwischen `festgeschrieben` und `bewertet` liegt das Aufdecken, und die
 * These lässt sich ab `festgeschrieben` nicht mehr ändern.
 */
export type TrainingStatus = 'offen' | 'festgeschrieben' | 'bewertet' | 'abgebrochen'

export function isTrainingStatus(v: unknown): v is TrainingStatus {
  return v === 'offen' || v === 'festgeschrieben' || v === 'bewertet' || v === 'abgebrochen'
}

export interface TrainingThesis {
  direction: TrainingDirection
  elliottCount: string | null
  invalidation: number | null
  entryPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  note: string | null
  setupTags: string[]
}

/**
 * Prüft die These, bevor sie festgeschrieben wird. Gibt die Liste der Mängel in
 * deutscher Sprache zurück (leer = in Ordnung) — dieselbe Funktion benutzen
 * Formular und Server, damit die Oberfläche nichts erlaubt, was der Server
 * ablehnt, und umgekehrt.
 */
export function validateThesis(mode: TrainingMode, thesis: TrainingThesis): string[] {
  const fehler: string[] = []

  if (!isTrainingDirection(thesis.direction)) {
    fehler.push('Richtung fehlt.')
  }

  // „Kein Setup" ist eine vollwertige Antwort — dann sind Level sinnlos.
  const mitPosition = thesis.direction === 'long' || thesis.direction === 'short'

  if (mitPosition && thesis.entryPrice != null && thesis.stopLoss != null) {
    if (thesis.direction === 'long' && thesis.stopLoss >= thesis.entryPrice) {
      fehler.push('Bei Long muss der Stop unter dem Einstieg liegen.')
    }
    if (thesis.direction === 'short' && thesis.stopLoss <= thesis.entryPrice) {
      fehler.push('Bei Short muss der Stop über dem Einstieg liegen.')
    }
  }

  if (mitPosition && thesis.entryPrice != null && thesis.takeProfit != null) {
    if (thesis.direction === 'long' && thesis.takeProfit <= thesis.entryPrice) {
      fehler.push('Bei Long muss das Ziel über dem Einstieg liegen.')
    }
    if (thesis.direction === 'short' && thesis.takeProfit >= thesis.entryPrice) {
      fehler.push('Bei Short muss das Ziel unter dem Einstieg liegen.')
    }
  }

  for (const [wert, name] of [
    [thesis.entryPrice, 'Einstieg'],
    [thesis.stopLoss, 'Stop'],
    [thesis.takeProfit, 'Ziel'],
    [thesis.invalidation, 'Invalidation'],
  ] as const) {
    if (wert != null && (!Number.isFinite(wert) || wert <= 0)) {
      fehler.push(`${name} ist kein gültiger Kurs.`)
    }
  }

  if (requiresElliott(mode)) {
    if (!thesis.elliottCount || thesis.elliottCount.trim().length === 0) {
      fehler.push('Im Elliott-Training ist die Wellenzählung Pflicht.')
    }
    if (thesis.invalidation == null && mitPosition) {
      fehler.push('Im Elliott-Training ist die Invalidation Pflicht.')
    }
  }

  return fehler
}

/** Freitext auf eine sinnvolle Länge stutzen (leer → `null`). */
export function trimText(raw: unknown, maxLen: number): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v.length === 0) return null
  return v.slice(0, maxLen)
}

export const MAX_NOTE_LEN = 2000
export const MAX_ELLIOTT_LEN = 120

/**
 * Trainingsstatistik (Phase 5 des Trainer-Plans) — rein und testbar.
 *
 * Bewusst getrennt von `lib/trade-stats.ts`: Dort geht es um echte Trades mit
 * echtem Geld, hier um Übungen. Eine Übungsquote, die neben der Equity-Kurve
 * steht, wäre genau die Selbsttäuschung, gegen die diese App gebaut ist —
 * deshalb rechnet diese Datei auch keine Beträge, sondern nur Trefferquoten
 * und Fehlerhäufigkeiten.
 *
 * Gezählt wird immer nur, was BEWERTET ist. Eine abgebrochene oder noch offene
 * Übung ist kein Ergebnis und darf keine Quote schönen.
 */

import { setupTagKey } from './setups'
import {
  TRAINING_ERROR_TAGS,
  trainingErrorLabel,
  type TrainingErrorTag,
  type TrainingMode,
  type TrainingRating,
} from './training'

/** Unter so vielen bewerteten Übungen steht keine Quote, sondern ihre Grundlage. */
export const MIN_TRAINING_RUNS = 10

/** Dieselbe Schwelle je Zeile einer Aufschlüsselung (Setup, Timeframe). */
export const MIN_TRAINING_BUCKET = 5

/** Eine bewertete Übung, wie die Auswertung sie braucht. */
export interface TrainingRunRow {
  id: number
  mode: TrainingMode
  symbol: string
  timeframe: string
  /** Anzeige-Formen der Setup-Tags (wie am Trade). */
  setupTags: string[]
  rating: TrainingRating | null
  errorTags: TrainingErrorTag[]
  /** Zeitpunkt der Bewertung — die Reihenfolge der Auswertung. */
  ratedAt: Date | null
}

export interface TrainingBucket {
  /** Anzahl bewerteter Übungen in dieser Zeile. */
  count: number
  korrekt: number
  teilweise: number
  falsch: number
  /**
   * Trefferquote in Prozent = korrekt / bewertet. `null`, solange die Zeile
   * unter ihrer Schwelle liegt — „100 %" aus einer Übung darf nicht aussehen
   * wie aus dreißig.
   */
  quote: number | null
  /** Anteil „teilweise korrekt" in Prozent, gleiche Schwelle. */
  teilQuote: number | null
}

export interface TrainingGroupRow extends TrainingBucket {
  key: string
  label: string
}

export interface TrainingErrorRow {
  id: TrainingErrorTag
  label: string
  elliott: boolean
  count: number
  /** Anteil an allen bewerteten Übungen, in Prozent. */
  share: number
}

export interface TrainingStats {
  /** Alle Übungen, auch offene und abgebrochene — die Grundgesamtheit. */
  total: number
  /** Nur die bewerteten. Jede Quote unten bezieht sich hierauf. */
  rated: number
  overall: TrainingBucket
  byTimeframe: TrainingGroupRow[]
  bySetup: TrainingGroupRow[]
  byMode: TrainingGroupRow[]
  errors: TrainingErrorRow[]
  /** Nur die Elliott-Fehler, absteigend — die Frage „welche Zählfehler mache ich". */
  elliottErrors: TrainingErrorRow[]
  /** Verlauf in Reihenfolge der Bewertung, für die kleine Kurve. */
  timeline: { id: number; rating: TrainingRating; ratedAt: Date | null }[]
  /** Wie viele der zuletzt bewerteten Übungen in Folge korrekt waren. */
  streak: number
  /** Übungen ohne jede Setup-Angabe — sichtbar, statt still zu fehlen. */
  ohneSetup: number
}

function emptyBucket(): TrainingBucket {
  return { count: 0, korrekt: 0, teilweise: 0, falsch: 0, quote: null, teilQuote: null }
}

function addToBucket(b: TrainingBucket, rating: TrainingRating): void {
  b.count++
  if (rating === 'korrekt') b.korrekt++
  else if (rating === 'teilweise') b.teilweise++
  else b.falsch++
}

function finishBucket(b: TrainingBucket, min: number): TrainingBucket {
  if (b.count >= min && b.count > 0) {
    b.quote = (b.korrekt / b.count) * 100
    b.teilQuote = (b.teilweise / b.count) * 100
  }
  return b
}

const MODE_LABEL: Record<TrainingMode, string> = {
  frei: 'Freie Übung',
  zufall: 'Zufallschart',
  elliott: 'Elliott-Training',
}

/**
 * Gruppiert nach einem Schlüssel je Übung. `keysOf` darf mehrere Schlüssel
 * liefern (Setup-Tags): dann zählt die Übung in jede ihrer Zeilen — dieselbe
 * Mehrfachzählung wie beim Setup-Vergleich der echten Trades.
 */
function group(
  rows: TrainingRunRow[],
  keysOf: (row: TrainingRunRow) => { key: string; label: string }[],
  min: number,
): TrainingGroupRow[] {
  const map = new Map<string, TrainingGroupRow>()
  for (const row of rows) {
    if (!row.rating) continue
    for (const { key, label } of keysOf(row)) {
      let entry = map.get(key)
      if (!entry) {
        entry = { key, label, ...emptyBucket() }
        map.set(key, entry)
      }
      addToBucket(entry, row.rating)
    }
  }
  return [...map.values()]
    .map((r) => {
      finishBucket(r, min)
      return r
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'))
}

export function computeTrainingStats(rows: TrainingRunRow[]): TrainingStats {
  const rated = rows.filter((r) => r.rating !== null)

  const overall = emptyBucket()
  for (const row of rated) addToBucket(overall, row.rating!)
  finishBucket(overall, MIN_TRAINING_RUNS)

  // Fehler zählen — je Übung zählt jedes Tag einmal.
  const errorCount = new Map<TrainingErrorTag, number>()
  for (const row of rated) {
    for (const tag of new Set(row.errorTags)) {
      errorCount.set(tag, (errorCount.get(tag) ?? 0) + 1)
    }
  }
  const errors: TrainingErrorRow[] = TRAINING_ERROR_TAGS.map((t) => ({
    id: t.id,
    label: trainingErrorLabel(t.id),
    elliott: t.elliott,
    count: errorCount.get(t.id) ?? 0,
    share: rated.length > 0 ? ((errorCount.get(t.id) ?? 0) / rated.length) * 100 : 0,
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'))

  // Verlauf: nach Bewertungszeitpunkt, fehlende Zeitstempel hinten (nach id).
  const timeline = [...rated]
    .sort((a, b) => {
      const ta = a.ratedAt ? a.ratedAt.getTime() : Number.POSITIVE_INFINITY
      const tb = b.ratedAt ? b.ratedAt.getTime() : Number.POSITIVE_INFINITY
      return ta - tb || a.id - b.id
    })
    .map((r) => ({ id: r.id, rating: r.rating!, ratedAt: r.ratedAt }))

  let streak = 0
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].rating !== 'korrekt') break
    streak++
  }

  return {
    total: rows.length,
    rated: rated.length,
    overall,
    byTimeframe: group(
      rated,
      (r) => [{ key: r.timeframe, label: r.timeframe }],
      MIN_TRAINING_BUCKET,
    ),
    bySetup: group(
      rated,
      (r) => {
        const out: { key: string; label: string }[] = []
        const seen = new Set<string>()
        for (const label of r.setupTags) {
          const key = setupTagKey(label)
          if (!key || seen.has(key)) continue
          seen.add(key)
          out.push({ key, label })
        }
        return out
      },
      MIN_TRAINING_BUCKET,
    ),
    byMode: group(
      rated,
      (r) => [{ key: r.mode, label: MODE_LABEL[r.mode] ?? r.mode }],
      MIN_TRAINING_BUCKET,
    ),
    errors,
    elliottErrors: errors.filter((e) => e.elliott),
    timeline,
    streak,
    ohneSetup: rated.filter((r) => r.setupTags.length === 0).length,
  }
}

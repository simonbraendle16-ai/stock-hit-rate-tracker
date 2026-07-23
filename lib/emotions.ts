// Der geschlossene Zustands-Katalog für den Emotions-Check-in (Etappe 4).
//
// Gemeinsame Quelle für den Dialog (Client), die Validierung in den Server
// Actions und die Auswertung in `lib/trade-stats.ts` — genau wie
// `lib/pre-trade-questions.ts` es für die Douglas-Fragen macht. Wer hier etwas
// ändert, ändert es überall zugleich; es gibt keine zweite Liste daneben.
//
// Bewusst KEINE frei erfundenen Tags: nur eine geschlossene Liste bleibt über
// Monate vergleichbar. Ein eigenes Tag zersplittert die Stichprobe und macht
// die Auswertung unschärfer, statt sie zu verfeinern.
//
// Die Datei ist rein (keine DB, kein React, kein 'use server') und daher direkt
// testbar — `lib/emotions.test.ts`.

// ---------------------------------------------------------------------------
// Skala
// ---------------------------------------------------------------------------

export const MOOD_MIN = 1
export const MOOD_MAX = 5

export type MoodScore = 1 | 2 | 3 | 4 | 5

/** Tonalität für die Einfärbung — die Komponente mappt sie auf feste Klassen. */
export type MoodTone = 'ruhig' | 'mittel' | 'unruhig'

export const MOOD_SCALE = [
  { value: 1, label: 'ruhig', hint: 'Klar. Der Ausgang lässt dich kalt.', tone: 'ruhig' },
  { value: 2, label: 'gefasst', hint: 'Leicht angespannt, aber im Griff.', tone: 'ruhig' },
  { value: 3, label: 'angespannt', hint: 'Der Ausgang beschäftigt dich spürbar.', tone: 'mittel' },
  { value: 4, label: 'unruhig', hint: 'Du willst, dass dieser Trade aufgeht.', tone: 'unruhig' },
  { value: 5, label: 'aufgewühlt', hint: 'Der Markt bestimmt gerade deine Laune.', tone: 'unruhig' },
] as const satisfies readonly { value: MoodScore; label: string; hint: string; tone: MoodTone }[]

/**
 * Auswertungs-Gruppen. Einzelne Skalenwerte sind zu fein: bei realistischen
 * Trade-Zahlen stünden hinter „4" drei Trades und hinter „5" einer — daraus
 * liest man ein Muster heraus, das keines ist. Drei Gruppen sind das Gröbste,
 * das die Frage „ruhig vs. aufgewühlt" noch beantwortet.
 */
export const MOOD_GROUPS = [
  { key: 'ruhig', label: 'ruhig (1–2)', min: 1, max: 2, tone: 'ruhig' },
  { key: 'angespannt', label: 'angespannt (3)', min: 3, max: 3, tone: 'mittel' },
  { key: 'aufgewuehlt', label: 'aufgewühlt (4–5)', min: 4, max: 5, tone: 'unruhig' },
] as const satisfies readonly {
  key: string
  label: string
  min: MoodScore
  max: MoodScore
  tone: MoodTone
}[]

export type MoodGroupKey = (typeof MOOD_GROUPS)[number]['key']

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * `belastend` = Zustände, die laut Douglas aus dem Mangel heraus handeln lassen.
 * `tragend` = Zustände, aus denen heraus ein Plan überhaupt ausführbar ist.
 * Die Einteilung dient nur der Darstellung — die Auswertung rechnet je Tag
 * einzeln und unterstellt keiner Gruppe ein Ergebnis.
 */
export type EmotionTone = 'belastend' | 'tragend'

export const EMOTION_TAGS = [
  { key: 'fomo', label: 'FOMO', tone: 'belastend', hint: 'Angst, etwas zu verpassen.' },
  { key: 'rache', label: 'Rache', tone: 'belastend', hint: 'Der letzte Verlust soll zurück.' },
  { key: 'langeweile', label: 'Langeweile', tone: 'belastend', hint: 'Handeln, um zu handeln.' },
  { key: 'angst', label: 'Angst', tone: 'belastend', hint: 'Verlust-Angst vor dem Einstieg.' },
  { key: 'gier', label: 'Gier', tone: 'belastend', hint: 'Mehr wollen, als der Plan hergibt.' },
  { key: 'ungeduld', label: 'Ungeduld', tone: 'belastend', hint: 'Das Setup nicht abwarten.' },
  { key: 'zuversicht', label: 'Zuversicht', tone: 'tragend', hint: 'Vertrauen in den Prozess.' },
  { key: 'gleichmut', label: 'Gleichmut', tone: 'tragend', hint: 'Ergebnis-offen, ohne Erwartung.' },
] as const satisfies readonly { key: string; label: string; tone: EmotionTone; hint: string }[]

export type EmotionTagKey = (typeof EMOTION_TAGS)[number]['key']

const TAG_INDEX = new Map<string, number>(EMOTION_TAGS.map((t, i) => [t.key, i]))

/** Anzeigename eines Tags; unbekannte Schlüssel kommen unverändert zurück. */
export function emotionTagLabel(key: string): string {
  return EMOTION_TAGS.find((t) => t.key === key)?.label ?? key
}

// ---------------------------------------------------------------------------
// Schwellen
// ---------------------------------------------------------------------------

/**
 * Ab wie vielen Trades eine Gruppe überhaupt eine Zahl zeigen darf.
 *
 * Darunter steht „noch zu wenige Daten" statt einer Quote. Aus drei Trades eine
 * Trefferquote zu lesen ist Scheinpräzision — und gerade beim Emotions-Thema
 * wäre die Versuchung groß, sie als Beweis zu nehmen.
 */
export const MIN_GROUP_SIZE = 10

/** Obergrenze für das Freitextfeld — eine Momentaufnahme, kein Tagebuch. */
export const MOOD_NOTE_MAX = 400

// ---------------------------------------------------------------------------
// Normalisierung / Validierung
// ---------------------------------------------------------------------------

/** Roh-Eingabe aus dem Dialog (oder von einem Client, dem man nicht traut). */
export type MoodCheckInput = {
  score: number | null
  tags: string[]
  note?: string | null
}

/** Geprüfte Momentaufnahme — nur das kommt in die Datenbank. */
export type NormalizedMood = {
  score: MoodScore
  tags: EmotionTagKey[]
  note: string | null
}

export function isMoodScore(v: unknown): v is MoodScore {
  return typeof v === 'number' && Number.isInteger(v) && v >= MOOD_MIN && v <= MOOD_MAX
}

/** Skalenwert aus beliebiger Eingabe; `null`, wenn er nicht 1–5 ist. */
export function normalizeMoodScore(v: unknown): MoodScore | null {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v)
  return isMoodScore(v) ? v : null
}

/**
 * Unbekannte Tags fallen raus, Doppelte auch, die Reihenfolge wird auf die
 * Katalog-Reihenfolge gebracht. Dadurch sind gespeicherte Tag-Listen zweier
 * Trades direkt vergleichbar und die Auswertung muss nichts mehr aufräumen.
 */
export function sanitizeMoodTags(v: unknown): EmotionTagKey[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  for (const raw of v) {
    if (typeof raw !== 'string') continue
    const key = raw.trim().toLowerCase()
    if (TAG_INDEX.has(key)) seen.add(key)
  }
  return [...seen].sort((a, b) => TAG_INDEX.get(a)! - TAG_INDEX.get(b)!) as EmotionTagKey[]
}

/** Tags aus der gespeicherten JSON-Spalte lesen — defekte Werte ergeben `[]`. */
export function parseMoodTags(raw: string | null | undefined): EmotionTagKey[] {
  if (!raw) return []
  try {
    return sanitizeMoodTags(JSON.parse(raw))
  } catch {
    return []
  }
}

/** Tags für die Spalte serialisieren; leere Auswahl wird `null`, nicht `"[]"`. */
export function serializeMoodTags(tags: readonly string[]): string | null {
  const clean = sanitizeMoodTags(tags)
  return clean.length ? JSON.stringify(clean) : null
}

/**
 * Vollständige Prüfung einer Momentaufnahme.
 *
 * `null` heißt: kein gültiger Skalenwert dabei — die aufrufende Server Action
 * lehnt den Vorgang dann mit einer Meldung ab, statt eine halbe Zeile zu
 * speichern. Tags und Notiz allein ergeben keinen auswertbaren Datenpunkt.
 */
export function normalizeMoodCheck(
  input: MoodCheckInput | null | undefined,
): NormalizedMood | null {
  if (!input) return null
  const score = normalizeMoodScore(input.score)
  if (score === null) return null
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, MOOD_NOTE_MAX) : ''
  return { score, tags: sanitizeMoodTags(input.tags), note: note || null }
}

/** Gruppe eines Skalenwerts; `null` für fehlende oder ungültige Werte. */
export function moodGroupOf(score: number | null | undefined): MoodGroupKey | null {
  const s = normalizeMoodScore(score)
  if (s === null) return null
  return MOOD_GROUPS.find((g) => s >= g.min && s <= g.max)!.key
}

/** Beschriftung einer Gruppe — eine Quelle für Tabelle und Badge. */
export function moodGroupLabel(key: MoodGroupKey): string {
  return MOOD_GROUPS.find((g) => g.key === key)!.label
}

/** Kurzform des Skalenwerts für Karten und Badges, z. B. „3 · angespannt". */
export function moodScoreLabel(score: number | null | undefined): string | null {
  const s = normalizeMoodScore(score)
  if (s === null) return null
  return `${s} · ${MOOD_SCALE[s - 1].label}`
}

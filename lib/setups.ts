// Setup-Tags (Etappe 7b) — die gemeinsame Quelle für Eingabe, Server-Gate und
// Auswertung. Rein und testbar: kein DB-Zugriff, kein React.
//
// Warum überhaupt Tags?
// `strategy` ist ein Freitextfeld. Zwei Trades mit demselben Setup stehen darin
// als „Breakout über Vortageshoch" und „breakout vortageshoch, sauber" — für den
// Menschen dasselbe, für jede Auswertung zwei verschiedene Dinge. Ohne einen
// vergleichbaren Schlüssel lässt sich die Frage „welches Setup verdient das
// Geld" nicht beantworten, egal wie sauber man schreibt.
//
// Warum KEIN fester Katalog (anders als bei den Emotions-Tags)?
// Emotionen sind allgemeinmenschlich — FOMO heißt bei jedem dasselbe. Setups
// sind es nicht: sie sind das persönliche Handwerk des Traders. Ein
// vorgegebener Katalog würde entweder nicht passen oder den Nutzer in fremde
// Kategorien zwingen und damit genau die Auswertung verfälschen, um die es
// geht. Die Tags sind deshalb frei benannt — die Vergleichbarkeit kommt nicht
// aus einer Liste, sondern aus der Normalisierung unten.
//
// Der Freitext bleibt erhalten. Er ist ab jetzt die Begründung („warum dieser
// Trade"), die Tags sind die Schublade („welches Setup"). Für Alt-Trades dient
// er zusätzlich als Migrationshilfe: `suggestSetupTags` schlägt daraus Tags vor,
// ohne je selbst etwas zu speichern.

/** Ein Tag in seinen zwei Formen: Anzeige-Text und Vergleichs-Schlüssel. */
export type SetupTag = {
  /** Normalisierter Schlüssel — nur er entscheidet, ob zwei Tags dasselbe sind. */
  key: string
  /** Die geschriebene Form, so wie sie der Nutzer eingegeben hat. */
  label: string
}

/**
 * Obergrenze je Tag. Ein Setup-Name, kein Satz — wer mehr braucht, schreibt es
 * in den Freitext daneben.
 */
export const SETUP_TAG_MAX_LEN = 28

/**
 * Höchstens drei Tags je Trade.
 *
 * Bewusst knapp: ein Trade hat in aller Regel *ein* Setup. Wären zehn Tags
 * erlaubt, würde jeder Trade in jeder Zeile der Auswertung auftauchen und die
 * Frage „welches Setup trägt mich" verlöre ihre Schärfe — Kombinationen wie
 * „Breakout + Trendfolge" bleiben mit drei Plätzen trotzdem möglich.
 */
export const MAX_SETUP_TAGS = 3

/**
 * Erst ab so vielen entschiedenen Trades zeigt ein Setup Quote und
 * Erwartungswert. Darunter steht „noch zu wenige Daten".
 *
 * Dieselbe Zahl wie bei der Emotions-Auswertung (`MIN_GROUP_SIZE`), aus
 * demselben Grund: aus vier Trades eine Setup-Trefferquote zu lesen ist
 * Scheinpräzision — und hier besonders teuer, weil man daraufhin ein
 * funktionierendes Setup aussortieren würde, das nur eine schlechte Woche
 * hatte. Die Roadmap hat 10 vorgeschlagen; dabei bleibt es.
 */
export const MIN_SETUP_TRADES = 10

/**
 * Vergleichs-Schlüssel eines Tags: klein geschrieben, Umlaute gefaltet, alles
 * ohne Buchstaben und Ziffern entfernt.
 *
 * Dadurch sind „Breakout", „breakout", „Break-Out" und „Break out" ein einziges
 * Setup — genau der Fehler, an dem die Freitext-Auswertung scheitert. Die
 * Faltung ä→ae ist die deutsche (nicht das Weglassen der Punkte), damit
 * „Rücksetzer" und „Ruecksetzer" zusammenfallen.
 *
 * `null`, wenn nach der Reinigung nichts übrig bleibt (z. B. nur „---").
 */
/** Kombinierende Akzentzeichen (U+0300–U+036F) — nach NFD alles, was „drüber" liegt. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

export function setupTagKey(label: string): string | null {
  const key = label
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    // Restliche Akzente (é, ñ, …) auf den Grundbuchstaben zurückführen.
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40)
  return key.length > 0 ? key : null
}

/**
 * Ein einzelnes Tag aus beliebiger Eingabe. Mehrfache Leerzeichen werden
 * zusammengezogen, die Länge begrenzt. `null`, wenn nichts Verwertbares
 * übrig bleibt.
 */
export function normalizeSetupTag(raw: unknown): SetupTag | null {
  if (typeof raw !== 'string') return null
  const label = raw.replace(/\s+/g, ' ').trim().slice(0, SETUP_TAG_MAX_LEN).trim()
  if (!label) return null
  const key = setupTagKey(label)
  return key ? { key, label } : null
}

/**
 * Tag-Liste eines Trades säubern: leere und doppelte Einträge raus (doppelt =
 * gleicher Schlüssel, nicht gleiche Schreibweise), Reihenfolge der Eingabe
 * bleibt, höchstens `MAX_SETUP_TAGS` Einträge.
 *
 * Zurück kommen die **Anzeige-Formen** — gespeichert wird, was der Nutzer
 * geschrieben hat; verglichen wird über den Schlüssel.
 */
export function sanitizeSetupTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of v) {
    const tag = normalizeSetupTag(raw)
    if (!tag || seen.has(tag.key)) continue
    seen.add(tag.key)
    out.push(tag.label)
    if (out.length >= MAX_SETUP_TAGS) break
  }
  return out
}

/** Tags aus der gespeicherten JSON-Spalte lesen — defekte Werte ergeben `[]`. */
export function parseSetupTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    return sanitizeSetupTags(JSON.parse(raw))
  } catch {
    return []
  }
}

/** Tags für die Spalte serialisieren; leere Auswahl wird `null`, nicht `"[]"`. */
export function serializeSetupTags(tags: unknown): string | null {
  const clean = sanitizeSetupTags(tags)
  return clean.length ? JSON.stringify(clean) : null
}

/** Die Schlüssel einer gespeicherten Tag-Liste — der Zugriff der Auswertung. */
export function setupTagKeys(raw: string | null | undefined): string[] {
  return parseSetupTags(raw)
    .map((label) => setupTagKey(label))
    .filter((k): k is string => k !== null)
}

// ---------------------------------------------------------------------------
// Migrationshilfe: aus altem Freitext Tags vorschlagen
// ---------------------------------------------------------------------------

/** Trennzeichen, an denen ein Freitext in Kandidaten zerfällt. */
const SPLIT = /[,;/|+·•\n\r\t]+/

/** Mehr Wörter als das ist ein Satz, kein Setup-Name. */
const MAX_WORDS = 3

/**
 * Vorschläge aus dem alten `strategy`-Freitext — **nur** ein Angebot an die
 * Eingabe-Maske, nie eine automatische Übernahme.
 *
 * Ein Backfill wäre hier falsch: aus „Long, weil der Markt stark aussah" würde
 * das Tag „Long weil der Markt stark aussah", und die Auswertung stünde
 * anschließend auf erfundenen Kategorien. Deshalb entscheidet der Mensch.
 *
 * Vorgeschlagen wird nur aus einem Text, der **als Ganzes** eine Aufzählung
 * ist: jeder einzelne Teil muss von der Form her ein Setup-Name sein können
 * (höchstens drei Wörter, mindestens zwei verwertbare Zeichen, nicht länger als
 * ein Tag). Sobald ein Teil Prosa ist, ist der ganze Text Prosa — dann kommt
 * kein Vorschlag. Sonst würde aus „Long, weil der Markt stark aussah" der
 * Vorschlag „Long", also eine Handelsrichtung, die als Setup gezählt würde.
 * Ein falscher Vorschlag ist hier teurer als keiner: er landet mit einem Klick
 * in der Auswertung.
 */
export function suggestSetupTags(freetext: string | null | undefined): string[] {
  if (!freetext) return []
  const out: string[] = []
  const seen = new Set<string>()

  for (const candidate of freetext.split(SPLIT)) {
    const tag = normalizeSetupTag(candidate)
    // Reine Trennzeichen-Reste („-", "  ") sagen nichts über die Form aus.
    if (!tag) continue
    const tooLong = candidate.replace(/\s+/g, ' ').trim().length > SETUP_TAG_MAX_LEN
    if (tag.key.length < 2 || tag.label.split(' ').length > MAX_WORDS || tooLong) return []
    if (seen.has(tag.key)) continue
    seen.add(tag.key)
    if (out.length < MAX_SETUP_TAGS) out.push(tag.label)
  }
  return out
}

// ---------------------------------------------------------------------------
// Bereits benutzte Tags einsammeln
// ---------------------------------------------------------------------------

export type SetupTagUsage = SetupTag & { count: number }

/**
 * Die schon vergebenen Tags über alle Trades, häufigste zuerst — die Vorlage
 * für die Auswahl in der Eingabe-Maske.
 *
 * Damit wächst der persönliche Katalog von selbst und ohne Tippfehler-Zwillinge:
 * wer „Breakout" einmal geschrieben hat, klickt es beim nächsten Mal an. Als
 * Anzeige-Form gewinnt die **häufigste** Schreibweise, bei Gleichstand die
 * zuerst gesehene — sonst benennt eine einmalige Kleinschreibung die ganze
 * Zeile der Auswertung um.
 */
export function rankSetupTags(rawColumns: readonly (string | null | undefined)[]): SetupTagUsage[] {
  const byKey = new Map<string, { count: number; labels: Map<string, number>; order: number }>()

  for (const raw of rawColumns) {
    for (const label of parseSetupTags(raw)) {
      const key = setupTagKey(label)
      if (!key) continue
      const entry = byKey.get(key) ?? { count: 0, labels: new Map(), order: byKey.size }
      entry.count++
      entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1)
      byKey.set(key, entry)
    }
  }

  return [...byKey.entries()]
    .map(([key, entry]) => {
      const label = [...entry.labels.entries()].sort((a, b) => b[1] - a[1])[0][0]
      return { key, label, count: entry.count, order: entry.order }
    })
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map(({ key, label, count }) => ({ key, label, count }))
}

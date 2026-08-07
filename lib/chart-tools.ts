/**
 * Die Werkzeug-Einstellungen des Nutzers: Favoriten, festgehaltenes Werkzeug,
 * Magnet.
 *
 * Warum in der Datenbank und nicht im Browser: dieselbe Begründung wie beim
 * Chart-Aussehen (`lib/chart-appearance.ts`). Eine Übung, die auf dem zweiten
 * Rechner andere Werkzeuge in der Leiste hat als der Ernstfall, übt das
 * Falsche — und eine Favoritenliste, die man auf jedem Gerät neu zusammenklickt,
 * ist keine.
 *
 * Wie beim Aussehen liegt alles als **JSON in einem Textfeld**: Je Wert eine
 * Spalte hieße, dass jede weitere Einstellung eine Migration ist.
 */

/** Höchstzahl der Favoriten — mehr passt nicht in eine schmale Leiste. */
export const MAX_FAVORITES = 12

/**
 * Muster einer Werkzeug-Kennung. Absichtlich eine Form- und keine
 * Bestandsprüfung.
 *
 * Geprüft wird NICHT gegen die heute bekannten Werkzeuge, und das ist Absicht:
 * Die Liste wächst (Pitchfork, Gann, Fib-Fan …). Stünde hier ein fester
 * Bestand, verlöre eine gespeicherte Favoritenliste beim Rollback einer
 * Erweiterung still ihre Einträge. Was die Leiste nicht kennt, blendet sie beim
 * Zeichnen aus — gespeichert bleibt es trotzdem.
 */
const TOOL_ID = /^[a-z][a-z0-9_]{1,23}$/

export interface ChartToolPrefs {
  /** Die Werkzeuge der Favoritenleiste, in der Reihenfolge der Leiste. */
  favorites: string[]
  /**
   * Bleibt das Werkzeug nach einer fertigen Zeichnung aktiv?
   *
   * Vorher sprang es immer zurück auf den Zeiger — wer fünf Niveaus einzeichnen
   * wollte, griff fünfmal in die Leiste. Beide Gewohnheiten sind verbreitet,
   * deshalb eine Einstellung und keine Entscheidung.
   */
  keepTool: boolean
  /** Magnet: Punkte auf O/H/L/C der nächsten Kerze ziehen. */
  magnet: boolean
}

/**
 * Der Auslieferungszustand.
 *
 * Die vier Startfavoriten sind bewusst die, mit denen ein Plan entsteht:
 * Trendlinie (Struktur), waagerechte Linie (Niveau), Fib (Ziel) und die
 * Long-Position (Entry/Stop/Target auf einen Blick). Kein Backfill — NULL in
 * der Spalte heißt genau diese vier.
 */
export const DEFAULT_TOOL_PREFS: ChartToolPrefs = {
  favorites: ['trendline', 'hline', 'fib', 'longpos'],
  keepTool: false,
  magnet: false,
}

/**
 * Aus beliebigem Gespeichertem eine gültige Einstellung machen.
 *
 * Nie werfen: Ein kaputter Eintrag darf die Werkzeugleiste nicht kosten. Jedes
 * Feld wird einzeln geprüft, Ungültiges fällt auf den Standard.
 */
export function normalizeToolPrefs(raw: unknown): ChartToolPrefs {
  const out: ChartToolPrefs = {
    favorites: [...DEFAULT_TOOL_PREFS.favorites],
    keepTool: DEFAULT_TOOL_PREFS.keepTool,
    magnet: DEFAULT_TOOL_PREFS.magnet,
  }
  if (raw == null) return out

  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return out
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return out
  const src = obj as Record<string, unknown>

  if (Array.isArray(src.favorites)) {
    const sauber: string[] = []
    for (const v of src.favorites) {
      if (typeof v !== 'string') continue
      const id = v.trim()
      // Doppelte Einträge würden zwei gleiche Knöpfe nebeneinander erzeugen.
      if (!TOOL_ID.test(id) || sauber.includes(id)) continue
      sauber.push(id)
      if (sauber.length >= MAX_FAVORITES) break
    }
    // Eine leer gespeicherte Liste ist eine gültige Aussage („keine
    // Favoriten"), kein fehlender Wert — sie darf nicht auf den Standard
    // zurückfallen. Genau deshalb wird hier auf `Array.isArray` geprüft und
    // nicht auf Länge.
    out.favorites = sauber
  }

  if (typeof src.keepTool === 'boolean') out.keepTool = src.keepTool
  if (typeof src.magnet === 'boolean') out.magnet = src.magnet

  return out
}

/**
 * Einen Favoriten setzen oder entfernen (der Stern am Werkzeug).
 *
 * Neue Favoriten hängen sich hinten an: Die Reihenfolge der Leiste ist eine
 * Gewohnheit, und ein neuer Eintrag darf sie nicht durcheinanderbringen.
 */
export function toggleFavorite(favorites: string[], id: string): string[] {
  if (favorites.includes(id)) return favorites.filter((f) => f !== id)
  if (favorites.length >= MAX_FAVORITES) return favorites
  return [...favorites, id]
}

/** Einen Favoriten an eine andere Stelle schieben (Ziehen in der Leiste). */
export function moveFavorite(favorites: string[], von: number, nach: number): string[] {
  if (von === nach) return favorites
  if (von < 0 || von >= favorites.length) return favorites
  const ziel = Math.min(Math.max(0, nach), favorites.length - 1)
  const kopie = [...favorites]
  const [raus] = kopie.splice(von, 1)
  kopie.splice(ziel, 0, raus)
  return kopie
}

/** Entspricht die Einstellung noch dem Auslieferungszustand? */
export function isDefaultToolPrefs(p: ChartToolPrefs): boolean {
  return (
    p.keepTool === DEFAULT_TOOL_PREFS.keepTool &&
    p.magnet === DEFAULT_TOOL_PREFS.magnet &&
    p.favorites.length === DEFAULT_TOOL_PREFS.favorites.length &&
    p.favorites.every((f, i) => f === DEFAULT_TOOL_PREFS.favorites[i])
  )
}

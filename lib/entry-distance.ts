// Etappe 14, Abschnitt 4: Wie weit ist der Kurs noch von einem geplanten
// Einstieg entfernt?
//
// WARUM DAS DIE EIGENTLICHE WATCHLIST-ZAHL IST
// Ein nackter Kurs beantwortet keine Frage. „AAPL 308,91" sagt nichts darüber,
// ob dieses Instrument gerade Aufmerksamkeit verdient. „Noch 2,1 % bis zu deinem
// Einstieg" sagt genau das — und macht aus einer alphabetischen Liste von
// neunzig Zeilen eine Rangfolge nach Nähe zur eigenen Entscheidung.
//
// Bewusst nur für Instrumente mit einem GEPLANTEN Trade. Ohne Plan gibt es
// keinen Einstieg, zu dem ein Abstand bestehen könnte — dort bleibt die Zeile
// leer, statt eine Zahl zu erfinden.

/** Ein geplanter Trade, so weit er für den Abstand gebraucht wird. */
export interface PlannedEntry {
  stockId: number | null
  status: string
  direction: string
  entryPrice: number
}

export interface EntryDistance {
  /** Vorzeichenbehaftet: negativ = der Kurs muss noch fallen, positiv = steigen. */
  pct: number
  /** Betrag — die Sortiergröße. */
  absPct: number
  entryPrice: number
  direction: string
  /** Hat der Kurs den Einstieg bereits erreicht oder überschritten? */
  reached: boolean
}

/**
 * Ab welchem Abstand ein Einstieg als „nah" gilt.
 *
 * Zwei Prozent sind keine Wahrheit über Märkte, sondern eine Anzeige-Schwelle:
 * Sie entscheidet, was hervorgehoben wird, nie was passiert. Bei Krypto ist das
 * eine Stunde, bei einem Index eine Woche — deshalb wird daraus auch keine
 * Handlungsempfehlung abgeleitet, nur eine Farbe.
 */
export const NEAR_ENTRY_PCT = 2

/**
 * Abstand des Kurses zum geplanten Einstieg, in Prozent des Einstiegs.
 *
 * `null`, wenn einer der beiden Werte fehlt oder unbrauchbar ist — ein Abstand
 * zu einem unbekannten Kurs wäre eine erfundene Zahl.
 *
 * **Richtung zählt mit:** Bei einem Long wartet man darauf, dass der Kurs FÄLLT
 * (Einstieg unter dem Kurs) oder ausbricht (Einstieg darüber); `reached` ist
 * deshalb nicht „Kurs == Einstieg", sondern „der Kurs liegt auf der Seite, auf
 * der der Plan ausgelöst hätte". Für einen Long mit Einstieg unter dem Kurs
 * heißt das: erreicht, sobald der Kurs auf oder unter dem Einstieg steht.
 */
export function entryDistance(
  price: number | null | undefined,
  entry: number | null | undefined,
  direction: string,
): EntryDistance | null {
  if (price == null || entry == null) return null
  if (!Number.isFinite(price) || !Number.isFinite(entry) || entry === 0) return null

  const pct = ((price - entry) / Math.abs(entry)) * 100
  const long = direction !== 'short'

  // Auf welcher Seite läge der Einstieg? Steht der Kurs ÜBER dem geplanten
  // Einstieg, wartet der Plan auf einen Rücksetzer (Kurs muss fallen); steht er
  // darunter, auf einen Ausbruch. Erreicht ist er, sobald der Kurs die Marke
  // von der Warteseite her berührt.
  const reached = long ? price <= entry : price >= entry

  return {
    pct,
    absPct: Math.abs(pct),
    entryPrice: entry,
    direction,
    // Ein Abstand von exakt 0 gilt als erreicht — dieselbe inklusive Haltung wie
    // bei den Kurs-Alerts (`isLevelReached`).
    reached: reached || pct === 0,
  }
}

/**
 * Der relevanteste geplante Einstieg je Instrument.
 *
 * Hat ein Instrument mehrere geplante Trades, zählt der NÄCHSTE — er ist der,
 * der als Erstes eine Entscheidung verlangt. Die übrigen sind deshalb nicht
 * verloren: Sie stehen weiter auf der Trade-Seite, nur eben nicht in der
 * Rangfolge der Watchlist.
 */
export function nearestEntryByStock(
  trades: readonly PlannedEntry[],
  quotes: Readonly<Record<number, { price: number } | undefined>>,
): Map<number, EntryDistance> {
  const out = new Map<number, EntryDistance>()

  for (const t of trades) {
    if (t.status !== 'geplant') continue
    if (t.stockId == null) continue
    const quote = quotes[t.stockId]
    if (!quote) continue

    const d = entryDistance(quote.price, t.entryPrice, t.direction)
    if (!d) continue

    const bisher = out.get(t.stockId)
    if (!bisher || d.absPct < bisher.absPct) out.set(t.stockId, d)
  }

  return out
}

/**
 * Sortierschlüssel für die Watchlist: kleiner = weiter oben.
 *
 * Reihenfolge der Absicht:
 *   1. erreichte Einstiege (die Entscheidung steht JETZT an)
 *   2. nahe Einstiege, aufsteigend nach Abstand
 *   3. alles ohne geplanten Einstieg — unverändert alphabetisch
 *
 * Instrumente ohne Plan rutschen dadurch nach unten, verschwinden aber nie: Die
 * Watchlist bleibt vollständig, sie ordnet nur anders.
 */
export function entrySortKey(d: EntryDistance | undefined): number {
  if (!d) return Number.POSITIVE_INFINITY
  if (d.reached) return -1
  return d.absPct
}

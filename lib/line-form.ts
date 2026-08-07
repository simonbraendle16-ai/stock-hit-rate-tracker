/**
 * Die Form einer Linien-Zeichnung: verlängert sie? trägt sie Pfeile? zeigt sie
 * Kennzahlen?
 *
 * WARUM ES DIESE DATEI GIBT
 * Bis hierher war jede Eigenschaft einer Linie ein eigener Zeichnungs-TYP:
 * `trendline` (Strecke), `ray` (nach rechts verlängert), `extendedline` (beidseitig),
 * `arrow` (mit Spitze), `infoline` (mit Kurs/%/Balken). Fünf Typen für eine
 * Zeichnung mit vier Häkchen.
 *
 * Das ist der eigentliche Unterschied zu TradingView — und er wurde erst durch
 * einen Blick in dessen Einstellungsdialog sichtbar. Dort ist all das EINE
 * Trendlinie mit den Optionen `Extend`, Endpunkt-Markern, `Stats` und
 * `Price labels`. Wer bei uns eine Strecke gezogen hatte und sie danach nach
 * rechts verlängern wollte, musste sie löschen und mit einem anderen Werkzeug
 * neu ziehen. Genau das lässt die Werkzeuge „fest" und billig wirken, während
 * die schiere Anzahl gar nicht das Problem war.
 *
 * WIE DER UMBAU OHNE BRUCH GEHT
 * Der Typ verschwindet nicht — er wird zur **Voreinstellung**. `ray` heißt ab
 * hier „eine Linie, die standardmäßig nach rechts verlängert ist"; der
 * gespeicherte Stil darf das überschreiben. Damit bleibt jede bestehende
 * Zeichnung unverändert gültig, es braucht **keine Migration** (der Stil liegt
 * ohnehin als JSON), und kein Altbestand muss angefasst werden.
 */

import type { DrawingStyle } from '@/app/actions/drawings'

/** In welche Richtungen eine Linie über ihre Punkte hinaus weiterläuft. */
export type Extend = 'none' | 'left' | 'right' | 'both'

/** Was an einem Linienende sitzt. */
export type EndCap = 'none' | 'arrow' | 'dot'

export const EXTEND_WERTE: Extend[] = ['none', 'left', 'right', 'both']
export const END_CAP_WERTE: EndCap[] = ['none', 'arrow', 'dot']

export interface LinienForm {
  extend: Extend
  /** Marker am ERSTEN Punkt. */
  leftEnd: EndCap
  /** Marker am ZWEITEN Punkt. */
  rightEnd: EndCap
  /** Kurs, Prozent und Balkenzahl an der Linie anzeigen. */
  stats: boolean
  /** Kurs-Etiketten an den Endpunkten. */
  priceLabels: boolean
  /** Zusätzlicher Anfasser in der Mitte (zum Verschieben ohne Verformen). */
  middlePoint: boolean
}

/**
 * Die Voreinstellung je Typ — also das, was das Werkzeug beim Anlegen bedeutet.
 *
 * Alles, was hier NICHT steht, ist eine gewöhnliche Strecke. Die Tabelle ist
 * bewusst klein: Sie beschreibt nur, worin sich die Werkzeuge unterscheiden.
 */
const VOREINSTELLUNG: Record<string, Partial<LinienForm>> = {
  ray: { extend: 'right' },
  extendedline: { extend: 'both' },
  arrow: { rightEnd: 'arrow' },
  infoline: { stats: true },
  hray: { extend: 'right' },
}

const STANDARD: LinienForm = {
  extend: 'none',
  leftEnd: 'none',
  rightEnd: 'none',
  stats: false,
  priceLabels: false,
  middlePoint: false,
}

function istExtend(v: unknown): v is Extend {
  return typeof v === 'string' && (EXTEND_WERTE as string[]).includes(v)
}

function istEndCap(v: unknown): v is EndCap {
  return typeof v === 'string' && (END_CAP_WERTE as string[]).includes(v)
}

/**
 * Typ + gespeicherter Stil → die tatsächliche Form.
 *
 * Reihenfolge: Standard, dann die Voreinstellung des Typs, dann der Stil. Der
 * Stil gewinnt immer — aber nur mit einem GÜLTIGEN Wert. Ungültiges fällt
 * einzeln zurück, nie die ganze Form; sonst verlöre eine Zeichnung wegen eines
 * kaputten Feldes auch ihre Pfeilspitze.
 */
export function linienForm(type: string, stil: DrawingStyle | null | undefined): LinienForm {
  const form: LinienForm = { ...STANDARD, ...(VOREINSTELLUNG[type] ?? {}) }
  if (!stil || typeof stil !== 'object') return form

  const s = stil as Record<string, unknown>
  if (istExtend(s.extend)) form.extend = s.extend
  if (istEndCap(s.leftEnd)) form.leftEnd = s.leftEnd
  if (istEndCap(s.rightEnd)) form.rightEnd = s.rightEnd
  if (typeof s.stats === 'boolean') form.stats = s.stats
  if (typeof s.priceLabels === 'boolean') form.priceLabels = s.priceLabels
  if (typeof s.middlePoint === 'boolean') form.middlePoint = s.middlePoint

  return form
}

/**
 * Die Form einer Flächen-Zeichnung (Rechteck & Co.).
 *
 * Abgeschaut aus TradingViews Rechteck-Dialog, der genau vier Dinge anbietet:
 * `Erweitern`, `Grenze` (der Rahmen), `Mittlere Linie` und `Hintergrund`. Bei
 * uns war die Füllung fest verdrahtet und eine Mittellinie gab es nicht — womit
 * sich ein Rechteck weder als reine Zone noch als reiner Rahmen benutzen ließ.
 */
export interface FlaechenForm {
  extend: Extend
  /** Rahmen zeichnen. */
  border: boolean
  /** Fläche füllen. */
  background: boolean
  /** Waagerechte Linie auf halber Höhe — die Mitte einer Zone. */
  middleLine: boolean
}

const FLAECHE_STANDARD: FlaechenForm = {
  extend: 'none',
  border: true,
  background: true,
  middleLine: false,
}

export function flaechenForm(
  _type: string,
  stil: DrawingStyle | null | undefined,
): FlaechenForm {
  const form: FlaechenForm = { ...FLAECHE_STANDARD }
  if (!stil || typeof stil !== 'object') return form

  const s = stil as Record<string, unknown>
  if (istExtend(s.extend)) form.extend = s.extend
  if (typeof s.border === 'boolean') form.border = s.border
  if (typeof s.background === 'boolean') form.background = s.background
  if (typeof s.middleLine === 'boolean') form.middleLine = s.middleLine

  return form
}

/**
 * Trägt dieser Zeichnungstyp eine Flächenform?
 *
 * Der **Kanal** gehört dazu, obwohl er aus zwei Linien besteht — in TradingViews
 * Dialog „Parallel channel" (an SBUX nachgesehen) stehen genau dieselben Regler:
 * `Extend`, `Background`, und eine Mittellinie. Dort ist sie sogar Teil einer
 * ganzen Level-Liste (−0.25 · 0 · 0.25 · 0.5 · 0.75 · 1 · 1.25, je mit eigener
 * Farbe und Strichart) — ein Kanal ist dort ein **Band mit Zwischenlinien**, kein
 * Zweiliniending. Die Mitte ist davon die einzige Linie, an der man tatsächlich
 * handelt; die Viertel sind hier bewusst nicht nachgebaut (siehe
 * `IDEEN-BACKLOG.md`), sonst stünde neben `FibStil` eine zweite Level-Verwaltung.
 */
export function istFlaechenTyp(type: string): boolean {
  return (
    type === 'rect' || type === 'pricerange' || type === 'daterange' || type === 'channel'
  )
}

/** Trägt dieser Zeichnungstyp überhaupt eine Linienform? */
export function istLinienTyp(type: string): boolean {
  return (
    type === 'trendline' ||
    type === 'ray' ||
    type === 'extendedline' ||
    type === 'arrow' ||
    type === 'infoline'
  )
}

/**
 * Die Endpunkte einer Linie nach Anwendung von `extend`.
 *
 * `verlaengern` kommt von außen (die Zeichenebene weiß, wo der Rand liegt) —
 * damit bleibt diese Datei frei von Pixeln und prüfbar.
 */
export function linienEnden<P>(
  a: P,
  b: P,
  extend: Extend,
  verlaengern: (von: P, durch: P) => P,
): { von: P; bis: P } {
  return {
    von: extend === 'left' || extend === 'both' ? verlaengern(b, a) : a,
    bis: extend === 'right' || extend === 'both' ? verlaengern(a, b) : b,
  }
}

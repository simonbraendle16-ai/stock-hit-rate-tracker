/**
 * Wie sich ein Zeichenwerkzeug bedienen lässt.
 *
 * Die Werkzeuge dieser App waren vollständig und trotzdem unbrauchbar, und der
 * Grund lag nicht an ihrer Zahl, sondern an einer einzigen Entscheidung: Jede
 * Zeichnung entstand aus GETRENNTEN KLICKS. Eine Trendlinie kostete zwei
 * Klicks, ein Kanal drei, ein Elliott-Zug sechs — und zwischen den Klicks sah
 * man nicht, was entsteht. In TradingView zieht man eine Linie in EINER Geste
 * auf: drücken, ziehen, loslassen. Das ist kein Komfort, sondern der
 * Unterschied zwischen „ich zeichne, was ich sehe" und „ich setze Punkte und
 * hoffe".
 *
 * Diese Entscheidung steht deshalb hier als reine Funktion und nicht im
 * Rumpf der 1150 Zeilen langen Zeichenebene: Sie ist in den letzten Runden
 * mehrfach nachgebessert worden, ohne dass irgendwo nachzulesen war, was
 * eigentlich gelten soll.
 */

import type { DrawingPoint } from '@/app/actions/drawings'
import type { DrawTool } from '@/components/chart/chart-toolbar'

/**
 * Ab wie vielen Pixeln eine Zeigerbewegung als Ziehen gilt.
 *
 * Darunter ist es ein Klick. Die Schwelle muss es geben, weil sonst jeder
 * Klick mit unruhiger Hand als Mini-Ziehen ankäme und eine zwei Pixel lange
 * Trendlinie erzeugte — genau das ist beim Zieh-Test passiert.
 */
export const KLICK_SCHWELLE = 4

export interface ToolSpec {
  /** Wie viele Punkte die fertige Zeichnung hat. */
  punkte: number
  /**
   * Lassen sich die ERSTEN ZWEI Punkte in einer Ziehbewegung setzen?
   *
   * Bei allem, was eine Strecke aufspannt, ja — Linie, Rechteck, Fib, Ellipse.
   * Bei einem Wellenzug nicht: Dort ist jeder Punkt eine eigene Aussage über
   * die Struktur, und ihn zu ziehen hieße, ihn zu raten.
   */
  zug: boolean
}

/**
 * Der Bauplan je Werkzeug — eine gemeinsame Quelle für Zeichenebene UND
 * Vorschau. Zwei Tabellen wären zwei Meinungen darüber, wann eine Zeichnung
 * fertig ist.
 *
 * Nicht enthalten sind die Werkzeuge mit eigenem Ablauf: `cursor`, `eraser`,
 * `text` (öffnet ein Feld), `measure` (flüchtig), `brush` (Freihand-Pfad) und
 * die Positions-Werkzeuge (die ihre drei Punkte selbst herleiten).
 */
export const TOOL_SPECS: Partial<Record<DrawTool, ToolSpec>> = {
  hline: { punkte: 1, zug: false },
  vline: { punkte: 1, zug: false },
  hray: { punkte: 1, zug: false },
  crossline: { punkte: 1, zug: false },
  infoline: { punkte: 2, zug: true },
  extendedline: { punkte: 2, zug: true },
  trendangle: { punkte: 2, zug: true },
  trendline: { punkte: 2, zug: true },
  ray: { punkte: 2, zug: true },
  arrow: { punkte: 2, zug: true },
  rect: { punkte: 2, zug: true },
  ellipse: { punkte: 2, zug: true },
  fib: { punkte: 2, zug: true },
  pricerange: { punkte: 2, zug: true },
  daterange: { punkte: 2, zug: true },
  // Drei-Punkt-Werkzeuge: Basis ziehen, dritter Punkt per Klick. So macht es
  // TradingView beim Kanal auch — die Parallele ist keine Strecke, sondern ein
  // Abstand.
  channel: { punkte: 3, zug: true },
  fibext: { punkte: 3, zug: true },
  // Wellenzüge und Muster: Punkt für Punkt. Jeder Punkt ist eine Behauptung
  // über die Struktur; ihn mitzuziehen wäre geraten.
  ew_impulse: { punkte: 6, zug: false },
  ew_correction: { punkte: 4, zug: false },
  ew_triangle: { punkte: 6, zug: false },
  ew_double: { punkte: 4, zug: false },
  ew_triple: { punkte: 6, zug: false },
  xabcd: { punkte: 5, zug: false },
  headshoulders: { punkte: 7, zug: false },
  // Fibonacci-Projektionen und Gann spannen eine Strecke auf wie das
  // Retracement — also ziehen.
  fibfan: { punkte: 2, zug: true },
  fibtime: { punkte: 2, zug: true },
  fibcircle: { punkte: 2, zug: true },
  gannbox: { punkte: 2, zug: true },
  // Pitchfork: Basis ziehen (B→C), der Scheitel A kommt als dritter Klick.
  pitchfork: { punkte: 3, zug: true },
  // Anmerkungen sitzen auf einem Punkt. `callout` läuft über das Textfeld und
  // steht deshalb NICHT hier (eigener Ablauf, wie `text`).
  pricelabel: { punkte: 1, zug: false },
  marker: { punkte: 1, zug: false },
}

/** Zeichnet dieses Werkzeug über `gesteAuswerten`? */
export function istZeichenwerkzeug(tool: DrawTool): boolean {
  return Object.prototype.hasOwnProperty.call(TOOL_SPECS, tool)
}

/** Hat sich der Zeiger weit genug bewegt, um als Ziehen zu gelten? */
export function istZug(
  start: { x: number; y: number },
  jetzt: { x: number; y: number },
): boolean {
  return Math.hypot(jetzt.x - start.x, jetzt.y - start.y) >= KLICK_SCHWELLE
}

export type GestenErgebnis =
  /** Fertig — die Zeichnung kann angelegt werden. */
  | { art: 'anlegen'; punkte: DrawingPoint[] }
  /** Es fehlen noch Punkte; diese sind gesetzt. */
  | { art: 'weiter'; punkte: DrawingPoint[] }
  /** Kein Zeichenwerkzeug. */
  | { art: 'nichts' }

/**
 * Was nach einer Zeigergeste geschieht.
 *
 * `gesetzt` sind die Punkte, die vorherige Klicks schon gesetzt haben.
 * `start` ist der Punkt beim Drücken, `ende` der beim Loslassen — bei einem
 * Klick sind beide praktisch gleich, und genau daran hängt der Unterschied:
 *
 * - **Gezogen** (und das Werkzeug kann es): Die Geste setzt zwei Punkte auf
 *   einen Schlag. Eine Trendlinie ist damit fertig, ein Kanal hat seine Basis.
 * - **Geklickt**: Der bisherige Weg bleibt vollständig erhalten — ein Punkt je
 *   Klick. Wer lieber klickt, verliert nichts; wer zieht, ist doppelt so
 *   schnell.
 */
export function gesteAuswerten(
  tool: DrawTool,
  gesetzt: DrawingPoint[],
  start: DrawingPoint,
  ende: DrawingPoint,
  gezogen: boolean,
): GestenErgebnis {
  const spec = TOOL_SPECS[tool]
  if (!spec) return { art: 'nichts' }

  // Ein-Punkt-Werkzeuge: Der Druck selbst ist die ganze Zeichnung. Ein
  // versehentliches Mitziehen darf eine waagerechte Linie nicht verschieben.
  if (spec.punkte <= 1) return { art: 'anlegen', punkte: [start] }

  const punkte =
    gezogen && spec.zug && gesetzt.length === 0 ? [start, ende] : [...gesetzt, ende]

  return punkte.length >= spec.punkte
    ? { art: 'anlegen', punkte: punkte.slice(0, spec.punkte) }
    : { art: 'weiter', punkte }
}

/**
 * Die Punkte für die laufende Vorschau, während der Zeiger unterwegs ist.
 *
 * Ohne sie zeichnet man blind: Bis zum letzten Klick war nicht zu sehen, was
 * entsteht — man setzte einen Punkt, bewegte die Maus und sah eine gestrichelte
 * Andeutung erst dann, wenn schon ein Punkt stand.
 */
export function vorschauPunkte(
  tool: DrawTool,
  gesetzt: DrawingPoint[],
  start: DrawingPoint | null,
  zeiger: DrawingPoint | null,
  gezogen: boolean,
): DrawingPoint[] {
  const spec = TOOL_SPECS[tool]
  if (!spec || !zeiger) return []
  if (spec.punkte <= 1) return [zeiger]
  if (gezogen && spec.zug && gesetzt.length === 0 && start) return [start, zeiger]
  return [...gesetzt, zeiger]
}

/**
 * Bleibt das Werkzeug nach einer fertigen Zeichnung aktiv?
 *
 * Bisher sprang es IMMER zurück auf den Zeiger. Wer fünf Niveaus einzeichnen
 * wollte, griff fünfmal in die Leiste — das ist der zweite Grund, warum das
 * Zeichnen sich zäh anfühlte. TradingView hält das Werkzeug auf Wunsch fest;
 * hier ist es eine Einstellung, weil beide Gewohnheiten verbreitet sind.
 */
export function werkzeugBleibt(tool: DrawTool, festhalten: boolean): boolean {
  if (!festhalten) return false
  // Der Radiergummi bleibt ohnehin aktiv, und `cursor` ist kein Werkzeug.
  return istZeichenwerkzeug(tool)
}

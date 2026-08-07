'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { chartDrawing, stock } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type DrawingType =
  | 'hline'
  | 'vline'
  | 'trendline'
  | 'ray'
  | 'rect'
  | 'fib'
  | 'text'
  // AP 10 (S4): TradingView-Tool-Vollausbau
  | 'channel' // paralleler Kanal (3 Punkte: Basislinie a–b + Offset c)
  | 'ellipse' // 2 Punkte = Bounding-Box
  | 'arrow' // Linie mit Pfeilspitze (2 Punkte)
  | 'brush' // Freihand-Pfad (n Punkte)
  | 'fibext' // Fib-Extension, trendbasiert (3 Punkte A/B/C)
  | 'longpos' // Long-Position: [Entry, Stop, Target] — Zeit von Punkt 2 = rechte Kante
  | 'shortpos' // Short-Position: [Entry, Stop, Target]
  | 'ew_impulse' // Elliott-Impuls 0-1-2-3-4-5 (6 Punkte)
  | 'ew_correction' // Elliott-Korrektur 0-A-B-C (4 Punkte)
  | 'pricerange' // Preis-Range (2 Punkte, Delta/%)
  | 'daterange' // Zeit-Range (2 Punkte, Balken/Dauer)
  // Etappe „Werkzeuge wie TradingView": die Werkzeuge, die bis dahin fehlten.
  | 'pitchfork' // Andrews' Pitchfork (3 Punkte: A + Basis B/C)
  | 'gannbox' // Gann-Box (2 Punkte = Bounding-Box, Raster 1/3 · 1/2 · 2/3)
  | 'fibfan' // Fib-Fan — Strahlen aus A durch die Fib-Höhen von A→B
  | 'fibtime' // Fib-Zeitzonen — senkrechte Linien im Fibonacci-Abstand
  | 'fibcircle' // Fib-Kreise — Kreisbögen um A mit den Fib-Anteilen von A→B
  | 'xabcd' // XABCD-Muster (5 Punkte)
  | 'headshoulders' // Kopf-Schulter (7 Punkte: LS, T1, K, T2, RS + Nackenlinie)
  | 'pricelabel' // Kurs-Etikett (1 Punkt, zeigt den Kurs)
  | 'callout' // Sprechblase mit Text (1 Punkt)
  | 'marker' // Marker/Fähnchen (1 Punkt)
  // Die übrigen drei Elliott-Zählungen aus TradingView. Sie fehlten als
  // einzige der fünf — und Elliott ist in dieser App keine Randnotiz.
  | 'ew_triangle' // Elliott-Dreieckswelle A-B-C-D-E (6 Punkte)
  | 'ew_double' // Elliott-Doppelkombo W-X-Y (4 Punkte)
  | 'ew_triple' // Elliott-Dreifachkombo W-X-Y-X-Z (6 Punkte)
  // Die restlichen Linien aus TradingViews „Linien"-Gruppe.
  | 'infoline' // Strecke mit Kurs-, Prozent- und Balkenangabe (2 Punkte)
  | 'extendedline' // Gerade, in BEIDE Richtungen verlängert (2 Punkte)
  | 'trendangle' // Strecke mit Winkelangabe gegen die Waagerechte (2 Punkte)
  | 'hray' // Horizontaler Strahl — ab dem Punkt nach rechts (1 Punkt)
  | 'crossline' // Fadenkreuz: waagerecht + senkrecht durch einen Punkt

export interface DrawingPoint {
  time: number // Unix-Sekunden
  price: number
  text?: string // nur bei type = 'text'
}

/**
 * Aussehen einer Zeichnung. Liegt als JSON in einer Textspalte — deshalb ist
 * eine Erweiterung hier **keine** Migration, und deshalb wird beim Lesen nie
 * blind vertraut: Farben laufen durch `normalizeDrawingStyle`
 * (`lib/drawing-style.ts`), Fib-Einstellungen durch `normalizeFibStil`
 * (`lib/fib-levels.ts`), bevor irgendetwas in ein SVG-Attribut geht.
 */
export interface DrawingStyle {
  color?: string
  dashed?: boolean
  label?: string
  /** Linienstärke in px. */
  width?: number
  /**
   * Fibonacci-Einstellung, nur bei `fib`/`fibext`. Bewusst `unknown`: Was hier
   * aus der Datenbank kommt, ist ungeprüft und wird erst beim Lesen normalisiert.
   */
  fib?: unknown
  /**
   * Form einer Linie — verlängern, Endpunkt-Marker, Kennzahlen, Kurs-Etiketten.
   *
   * Damit werden `ray`, `arrow` und `infoline` zu VOREINSTELLUNGEN eines Typs
   * statt zu eigenen Zeichnungen: Eine gezogene Strecke lässt sich nachträglich
   * verlängern, statt sie löschen und neu ziehen zu müssen. Gelesen wird
   * ausschließlich über `linienForm` (`lib/line-form.ts`) — auch das hier ist
   * ungeprüftes JSON aus der Datenbank.
   *
   * Keine Migration nötig: Der Stil liegt ohnehin als JSON in einer Textspalte.
   */
  extend?: unknown
  leftEnd?: unknown
  rightEnd?: unknown
  stats?: unknown
  priceLabels?: unknown
  middlePoint?: unknown
  /**
   * Form einer Fläche (Rechteck) — Rahmen, Füllung und Mittellinie einzeln.
   * Gelesen über `flaechenForm` (`lib/line-form.ts`).
   */
  border?: unknown
  background?: unknown
  middleLine?: unknown
}

export interface Drawing {
  id: number
  /**
   * Fehlt bei den Zeichnungen einer Trainingseinheit: die hängen an einer
   * Übung (`training_annotation`), nicht an einem Instrument. Die Zeichenebene
   * selbst braucht das Feld nicht — sie kennt nur Punkte und Typ.
   */
  stockId?: number
  type: DrawingType
  points: DrawingPoint[]
  style: DrawingStyle | null
}

const VALID_TYPES: DrawingType[] = [
  'hline',
  'vline',
  'trendline',
  'ray',
  'rect',
  'fib',
  'text',
  'channel',
  'ellipse',
  'arrow',
  'brush',
  'fibext',
  'longpos',
  'shortpos',
  'ew_impulse',
  'ew_correction',
  'pricerange',
  'daterange',
  'pitchfork',
  'gannbox',
  'fibfan',
  'fibtime',
  'fibcircle',
  'xabcd',
  'headshoulders',
  'pricelabel',
  'callout',
  'marker',
  'ew_triangle',
  'ew_double',
  'ew_triple',
  'infoline',
  'extendedline',
  'trendangle',
  'hray',
  'crossline',
]

/**
 * Maximale Punktzahl je Typ.
 *
 * Stand bis hierher hart auf 4 (außer Freihand und Elliott) — und war damit
 * genau die Stelle, an der ein neues Werkzeug mit mehr Punkten still am Server
 * scheiterte. Die Ausnahmen stehen deshalb jetzt als Tabelle da, nicht als
 * `if`-Kette.
 */
const MAX_POINTS: Partial<Record<DrawingType, number>> = {
  brush: 500,
  ew_impulse: 6,
  ew_correction: 4,
  headshoulders: 7,
  xabcd: 5,
  ew_triangle: 6,
  ew_double: 4,
  ew_triple: 6,
}

function maxPoints(type: DrawingType): number {
  return MAX_POINTS[type] ?? 4
}

function parseDrawing(row: typeof chartDrawing.$inferSelect): Drawing {
  return {
    id: row.id,
    stockId: row.stockId,
    type: row.type as DrawingType,
    points: JSON.parse(row.points),
    style: row.style ? JSON.parse(row.style) : null,
  }
}

function validate(type: string, points: DrawingPoint[]) {
  if (!VALID_TYPES.includes(type as DrawingType)) throw new Error('Unbekannter Zeichnungstyp.')
  if (
    !Array.isArray(points) ||
    points.length === 0 ||
    points.length > maxPoints(type as DrawingType)
  ) {
    throw new Error('Ungültige Punkte.')
  }
  for (const p of points) {
    if (!Number.isFinite(p.time) || !Number.isFinite(p.price)) {
      throw new Error('Ungültige Punkte.')
    }
  }
}

async function assertOwnStock(userId: string, stockId: number) {
  const [owned] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.id, stockId), eq(stock.userId, userId)))
  if (!owned) throw new Error('Instrument nicht gefunden.')
}

export async function getDrawings(stockId: number): Promise<Drawing[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(chartDrawing)
    .where(and(eq(chartDrawing.userId, userId), eq(chartDrawing.stockId, stockId)))
    .orderBy(asc(chartDrawing.id))
  return rows.map(parseDrawing)
}

export async function createDrawing(input: {
  stockId: number
  type: DrawingType
  points: DrawingPoint[]
  style?: Drawing['style']
}): Promise<Drawing> {
  const userId = await getUserId()
  validate(input.type, input.points)
  await assertOwnStock(userId, input.stockId)

  const [row] = await db
    .insert(chartDrawing)
    .values({
      userId,
      stockId: input.stockId,
      type: input.type,
      points: JSON.stringify(input.points),
      style: input.style ? JSON.stringify(input.style) : null,
    })
    .returning()
  return parseDrawing(row)
}

export async function updateDrawing(input: {
  id: number
  points: DrawingPoint[]
  style?: Drawing['style']
}): Promise<void> {
  const userId = await getUserId()
  const [existing] = await db
    .select({ type: chartDrawing.type })
    .from(chartDrawing)
    .where(and(eq(chartDrawing.id, input.id), eq(chartDrawing.userId, userId)))
  if (!existing) throw new Error('Zeichnung nicht gefunden.')
  validate(existing.type, input.points)

  await db
    .update(chartDrawing)
    .set({
      points: JSON.stringify(input.points),
      ...(input.style !== undefined
        ? { style: input.style ? JSON.stringify(input.style) : null }
        : {}),
    })
    .where(and(eq(chartDrawing.id, input.id), eq(chartDrawing.userId, userId)))
}

export async function deleteDrawing(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(chartDrawing)
    .where(and(eq(chartDrawing.id, id), eq(chartDrawing.userId, userId)))
}

/** Alle Zeichnungen des Users für EIN Instrument löschen (Toolbar „Alle löschen“). */
export async function deleteAllDrawings(stockId: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(chartDrawing)
    .where(and(eq(chartDrawing.userId, userId), eq(chartDrawing.stockId, stockId)))
}

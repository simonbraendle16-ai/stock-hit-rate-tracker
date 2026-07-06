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

export interface DrawingPoint {
  time: number // Unix-Sekunden
  price: number
  text?: string // nur bei type = 'text'
}

export interface Drawing {
  id: number
  stockId: number
  type: DrawingType
  points: DrawingPoint[]
  style: { color?: string; dashed?: boolean; label?: string } | null
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
]

/** Maximale Punktzahl je Typ (Brush = Freihand-Pfad, Elliott = Wellenzug). */
function maxPoints(type: DrawingType): number {
  if (type === 'brush') return 500
  if (type === 'ew_impulse') return 6
  if (type === 'ew_correction') return 4
  return 4
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

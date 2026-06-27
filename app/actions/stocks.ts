'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stock, assessment } from '@/lib/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type StockWithStats = {
  id: number
  name: string
  ticker: string
  correct: number
  wrong: number
  total: number
  hitRate: number // 0-100
}

export type OverallStats = {
  correct: number
  wrong: number
  total: number
  hitRate: number // 0-100
  stockCount: number
}

export type TimelinePoint = {
  date: string // ISO date
  label: string
  hitRate: number // cumulative hit rate 0-100
  correct: number
  wrong: number
}

/** All stocks for the user, with aggregated stats, ordered by hit rate desc. */
export async function getStocksWithStats(): Promise<StockWithStats[]> {
  const userId = await getUserId()

  const stocks = await db
    .select()
    .from(stock)
    .where(eq(stock.userId, userId))

  const assessments = await db
    .select()
    .from(assessment)
    .where(eq(assessment.userId, userId))

  const byStock = new Map<number, { correct: number; wrong: number }>()
  for (const a of assessments) {
    const entry = byStock.get(a.stockId) ?? { correct: 0, wrong: 0 }
    if (a.isCorrect) entry.correct++
    else entry.wrong++
    byStock.set(a.stockId, entry)
  }

  const result: StockWithStats[] = stocks.map((s) => {
    const counts = byStock.get(s.id) ?? { correct: 0, wrong: 0 }
    const total = counts.correct + counts.wrong
    const hitRate = total > 0 ? (counts.correct / total) * 100 : 0
    return {
      id: s.id,
      name: s.name,
      ticker: s.ticker,
      correct: counts.correct,
      wrong: counts.wrong,
      total,
      hitRate,
    }
  })

  // Sort by hit rate desc, then by total assessments desc as tie-breaker.
  result.sort((a, b) => {
    if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate
    return b.total - a.total
  })

  return result
}

/** Aggregate stats across all stocks. */
export async function getOverallStats(): Promise<OverallStats> {
  const userId = await getUserId()

  const stocks = await db
    .select()
    .from(stock)
    .where(eq(stock.userId, userId))

  const assessments = await db
    .select()
    .from(assessment)
    .where(eq(assessment.userId, userId))

  const correct = assessments.filter((a) => a.isCorrect).length
  const wrong = assessments.length - correct
  const total = assessments.length
  const hitRate = total > 0 ? (correct / total) * 100 : 0

  return { correct, wrong, total, hitRate, stockCount: stocks.length }
}

/** Cumulative hit rate over time across all assessments (chronological). */
export async function getHitRateTimeline(): Promise<TimelinePoint[]> {
  const userId = await getUserId()

  const assessments = await db
    .select()
    .from(assessment)
    .where(eq(assessment.userId, userId))
    .orderBy(asc(assessment.assessmentDate), asc(assessment.id))

  const points: TimelinePoint[] = []
  let correct = 0
  let wrong = 0

  for (const a of assessments) {
    if (a.isCorrect) correct++
    else wrong++
    const total = correct + wrong
    const d = new Date(a.assessmentDate)
    points.push({
      date: d.toISOString(),
      label: d.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      }),
      hitRate: (correct / total) * 100,
      correct,
      wrong,
    })
  }

  return points
}

/** Create a new stock. */
export async function addStock(formData: {
  name: string
  ticker: string
}): Promise<{ id: number }> {
  const userId = await getUserId()
  const name = formData.name.trim()
  const ticker = formData.ticker.trim().toUpperCase()
  if (!name || !ticker) throw new Error('Name und Ticker sind erforderlich.')

  const [row] = await db
    .insert(stock)
    .values({ userId, name, ticker })
    .returning({ id: stock.id })

  revalidatePath('/')
  return { id: row.id }
}

/** Add an individual assessment (correct or wrong) for a stock. */
export async function addAssessment(formData: {
  stockId: number
  isCorrect: boolean
  note?: string
  assessmentDate?: string // ISO date string
  predictedDirection?: 'long' | 'short' | null
  elliottCount?: string | null
}): Promise<void> {
  const userId = await getUserId()

  // Verify the stock belongs to this user.
  const [owned] = await db
    .select({ id: stock.id })
    .from(stock)
    .where(and(eq(stock.id, formData.stockId), eq(stock.userId, userId)))

  if (!owned) throw new Error('Aktie nicht gefunden.')

  await db.insert(assessment).values({
    userId,
    stockId: formData.stockId,
    isCorrect: formData.isCorrect,
    note: formData.note?.trim() || null,
    predictedDirection: formData.predictedDirection ?? null,
    elliottCount: formData.elliottCount?.trim() || null,
    assessmentDate: formData.assessmentDate
      ? new Date(formData.assessmentDate)
      : new Date(),
  })

  revalidatePath('/')
}

/** Get all assessments for a single stock (most recent first). */
export async function getAssessmentsForStock(stockId: number) {
  const userId = await getUserId()
  return db
    .select()
    .from(assessment)
    .where(and(eq(assessment.stockId, stockId), eq(assessment.userId, userId)))
    .orderBy(asc(assessment.assessmentDate))
}

export type AssessmentEntry = {
  id: number
  isCorrect: boolean
  note: string | null
  assessmentDate: string // ISO date
}

export type StockDetail = {
  id: number
  name: string
  ticker: string
  createdAt: string // ISO date
  correct: number
  wrong: number
  total: number
  hitRate: number // 0-100
  timeline: TimelinePoint[]
  assessments: AssessmentEntry[]
}

/** Full detail for a single stock: stats, per-stock hit-rate timeline and all entries. */
export async function getStockDetail(
  stockId: number,
): Promise<StockDetail | null> {
  const userId = await getUserId()

  const [owned] = await db
    .select()
    .from(stock)
    .where(and(eq(stock.id, stockId), eq(stock.userId, userId)))

  if (!owned) return null

  const rows = await db
    .select()
    .from(assessment)
    .where(and(eq(assessment.stockId, stockId), eq(assessment.userId, userId)))
    .orderBy(asc(assessment.assessmentDate), asc(assessment.id))

  let correct = 0
  let wrong = 0
  const timeline: TimelinePoint[] = []
  const assessments: AssessmentEntry[] = []

  for (const a of rows) {
    if (a.isCorrect) correct++
    else wrong++
    const total = correct + wrong
    const d = new Date(a.assessmentDate)
    timeline.push({
      date: d.toISOString(),
      label: d.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      }),
      hitRate: (correct / total) * 100,
      correct,
      wrong,
    })
    assessments.push({
      id: a.id,
      isCorrect: a.isCorrect,
      note: a.note,
      assessmentDate: d.toISOString(),
    })
  }

  // Newest entries first for the list view.
  assessments.reverse()

  const total = correct + wrong
  const hitRate = total > 0 ? (correct / total) * 100 : 0

  return {
    id: owned.id,
    name: owned.name,
    ticker: owned.ticker,
    createdAt: new Date(owned.createdAt).toISOString(),
    correct,
    wrong,
    total,
    hitRate,
    timeline,
    assessments,
  }
}

/** Delete a single assessment. */
export async function deleteAssessment(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(assessment)
    .where(and(eq(assessment.id, id), eq(assessment.userId, userId)))
  revalidatePath('/')
}

/** Delete a stock and all of its assessments. */
export async function deleteStock(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(assessment)
    .where(and(eq(assessment.stockId, id), eq(assessment.userId, userId)))
  await db
    .delete(stock)
    .where(and(eq(stock.id, id), eq(stock.userId, userId)))
  revalidatePath('/')
}

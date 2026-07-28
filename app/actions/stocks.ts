'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stock, assessment, trade } from '@/lib/db/schema'
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

type StockRow = typeof stock.$inferSelect

/** Postgres „undefined column“ (42703) — Migration 0009 oder 0019 fehlt noch. */
function isMissingColumn(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; cause?: { code?: string }; message?: string }
  return (
    e.code === '42703' ||
    e.cause?.code === '42703' ||
    /watchlistSection|sortOrder|providerSymbol|resolution/.test(e.message ?? '')
  )
}

/**
 * `stock`-Zeilen laden, tolerant gegenüber fehlenden Migrationen: Fehlen die
 * Sektions-Spalten (0009) oder die Auflösungs-Spalten (0019) in der DB, wird
 * ohne sie geladen und mit Defaults aufgefüllt — die Watchlist läuft dann ohne
 * Sektionen bzw. ohne Kursauflösung, statt zu crashen.
 */
async function selectStocksTolerant(where: SQL | undefined): Promise<StockRow[]> {
  try {
    return await db.select().from(stock).where(where)
  } catch (err) {
    if (!isMissingColumn(err)) throw err
    const rows = await db
      .select({
        id: stock.id,
        userId: stock.userId,
        name: stock.name,
        ticker: stock.ticker,
        market: stock.market,
        chartUrl: stock.chartUrl,
        createdAt: stock.createdAt,
      })
      .from(stock)
      .where(where)
    return rows.map((r) => ({
      ...r,
      watchlistSection: null,
      sortOrder: 0,
      providerSymbol: null,
      provider: null,
      resolutionStatus: null,
      resolutionConfidence: null,
      resolvedName: null,
      resolvedExchange: null,
      resolvedCurrency: null,
      resolutionNote: null,
      resolutionCandidates: null,
      resolutionPinned: false,
      resolutionApproximate: false,
      resolvedAt: null,
    }))
  }
}

/**
 * Normalisiert einen optionalen Chart-Link. Leerer Input → null.
 * Fehlendes Schema wird als https:// ergänzt. Nur http/https werden akzeptiert.
 */
function normalizeChartUrl(raw?: string | null): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('Chart-Link ist keine gültige URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Chart-Link muss mit http:// oder https:// beginnen.')
  }
  return parsed.toString()
}

export type StockWithStats = {
  id: number
  name: string
  ticker: string
  market: string
  chartUrl: string | null
  watchlistSection: string | null
  correct: number
  wrong: number
  notReached: number // Zone nicht angelaufen (neutral)
  total: number // entscheidungsrelevant = correct + wrong
  hitRate: number // 0-100
  // Etappe 9 „Symbolauflösung": Damit die Watchlist einen fehlenden Kurs
  // ERKLÄREN kann statt ihn nur wegzulassen.
  providerSymbol: string | null
  resolutionStatus: string | null
  resolutionNote: string | null
  resolutionApproximate: boolean
  resolutionPinned: boolean
  /** Geprüfte Alternativen für den Reparatur-Dialog (JSON aus der DB). */
  resolutionCandidates: string | null
}

export type OverallStats = {
  correct: number
  wrong: number
  notReached: number // Zone nicht angelaufen (neutral)
  total: number // entscheidungsrelevant = correct + wrong
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

  const stocks = await selectStocksTolerant(eq(stock.userId, userId))

  const assessments = await db
    .select()
    .from(assessment)
    .where(eq(assessment.userId, userId))

  const byStock = new Map<number, { correct: number; wrong: number; notReached: number }>()
  for (const a of assessments) {
    const entry = byStock.get(a.stockId) ?? { correct: 0, wrong: 0, notReached: 0 }
    if (a.zoneNotReached) entry.notReached++
    else if (a.isCorrect) entry.correct++
    else entry.wrong++
    byStock.set(a.stockId, entry)
  }

  const result: StockWithStats[] = stocks.map((s) => {
    const counts = byStock.get(s.id) ?? { correct: 0, wrong: 0, notReached: 0 }
    const total = counts.correct + counts.wrong
    const hitRate = total > 0 ? (counts.correct / total) * 100 : 0
    return {
      id: s.id,
      name: s.name,
      ticker: s.ticker,
      market: s.market,
      chartUrl: s.chartUrl,
      watchlistSection: s.watchlistSection,
      correct: counts.correct,
      wrong: counts.wrong,
      notReached: counts.notReached,
      total,
      hitRate,
      providerSymbol: s.providerSymbol,
      resolutionStatus: s.resolutionStatus,
      resolutionNote: s.resolutionNote,
      resolutionApproximate: !!s.resolutionApproximate,
      resolutionPinned: !!s.resolutionPinned,
      resolutionCandidates: s.resolutionCandidates,
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

  const stocks = await selectStocksTolerant(eq(stock.userId, userId))

  const assessments = await db
    .select()
    .from(assessment)
    .where(eq(assessment.userId, userId))

  const decisive = assessments.filter((a) => !a.zoneNotReached)
  const correct = decisive.filter((a) => a.isCorrect).length
  const wrong = decisive.length - correct
  const notReached = assessments.length - decisive.length
  const total = decisive.length
  const hitRate = total > 0 ? (correct / total) * 100 : 0

  return { correct, wrong, notReached, total, hitRate, stockCount: stocks.length }
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
    if (a.zoneNotReached) continue // neutral, zählt nicht in die Trefferquote
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

const VALID_MARKETS = [
  'aktien',
  'krypto',
  'forex',
  'rohstoffe',
  'etf',
  'optionen',
  'sonstiges',
] as const

/** Create a new stock. */
export async function addStock(formData: {
  name: string
  ticker: string
  market?: string
  chartUrl?: string | null
  section?: string | null
}): Promise<{ id: number }> {
  const userId = await getUserId()
  const name = formData.name.trim()
  const ticker = formData.ticker.trim().toUpperCase()
  if (!name || !ticker) throw new Error('Name und Ticker sind erforderlich.')
  const market = (VALID_MARKETS as readonly string[]).includes(formData.market ?? '')
    ? (formData.market as string)
    : 'aktien'
  const chartUrl = normalizeChartUrl(formData.chartUrl)

  const values = {
    userId,
    name,
    ticker,
    market,
    chartUrl,
    watchlistSection: (formData.section ?? '').trim().slice(0, 40) || null,
  }
  let row: { id: number }
  try {
    ;[row] = await db.insert(stock).values(values).returning({ id: stock.id })
  } catch (err) {
    // Migration 0009 fehlt noch → ohne Sektions-Spalte anlegen.
    if (!isMissingColumn(err)) throw err
    const { watchlistSection: _ignored, ...legacy } = values
    ;[row] = await db.insert(stock).values(legacy).returning({ id: stock.id })
  }

  // Bestehende Trades desselben Tickers nachträglich anhängen.
  //
  // `createTrade` verknüpft nur im Moment des Anlegens: existiert das Instrument
  // da noch nicht, bleibt `stockId` leer — und blieb es bisher für immer. Ein
  // später angelegtes Instrument holt seine Trades jetzt nach, sonst fehlen dem
  // Trade dauerhaft Chart, Kerzen und Bot-Zwilling.
  //
  // Nur unverknüpfte Zeilen (`stockId IS NULL`) werden angefasst; eine bereits
  // bestehende Zuordnung wird nie überschrieben.
  const linked = await db
    .update(trade)
    .set({ stockId: row.id })
    .where(and(eq(trade.userId, userId), eq(trade.ticker, ticker), isNull(trade.stockId)))
    .returning({ id: trade.id })

  // Symbol sofort auflösen und den ersten Kurs holen.
  //
  // Bewusst hier und nicht erst im nächsten Hintergrundlauf: Ein frisch
  // angelegtes Instrument, das eine Viertelstunde lang ohne Kurs dasteht, ist
  // genau der Zustand, den diese Etappe beseitigen soll. Und wenn der Ticker
  // nicht auflösbar ist, erfährt man es in dem Moment, in dem man ihn eintippt —
  // nicht Tage später beim Draufschauen.
  //
  // Fehlschläge sind absichtlich folgenlos: Das Instrument ist angelegt, die
  // Auflösung holt der Hintergrundlauf nach. Ein hängender Anbieter darf das
  // Anlegen nicht verhindern.
  try {
    const { runSymbolSync } = await import('@/lib/market-data/sync')
    await runSymbolSync({ trigger: 'manual', onlyStockIds: [row.id], forceResolve: true })
  } catch {
    /* siehe oben — der Hintergrundlauf holt es nach */
  }

  revalidatePath('/')
  revalidatePath('/watchlist')
  if (linked.length) {
    revalidatePath('/trades')
    revalidatePath(`/stock/${row.id}`)
  }
  return { id: row.id }
}

/** Watchlist-Sektion setzen oder entfernen (null/leer = „Ohne Sektion“). */
export async function setWatchlistSection(
  stockId: number,
  section: string | null,
): Promise<void> {
  const userId = await getUserId()
  const normalized = (section ?? '').trim().slice(0, 40) || null

  let result: { id: number }[]
  try {
    result = await db
      .update(stock)
      .set({ watchlistSection: normalized })
      .where(and(eq(stock.id, stockId), eq(stock.userId, userId)))
      .returning({ id: stock.id })
  } catch (err) {
    if (isMissingColumn(err)) {
      throw new Error(
        'Watchlist-Sektionen benötigen die DB-Migration 0009 — bitte einmal `pnpm db:push` ausführen.',
      )
    }
    throw err
  }

  if (result.length === 0) throw new Error('Instrument nicht gefunden.')

  revalidatePath('/watchlist')
}

/** Set or clear the chart link for an existing stock. */
export async function updateStockChartUrl(
  stockId: number,
  chartUrl: string | null,
): Promise<void> {
  const userId = await getUserId()
  const normalized = normalizeChartUrl(chartUrl)

  const result = await db
    .update(stock)
    .set({ chartUrl: normalized })
    .where(and(eq(stock.id, stockId), eq(stock.userId, userId)))
    .returning({ id: stock.id })

  if (result.length === 0) throw new Error('Aktie nicht gefunden.')

  revalidatePath('/')
  revalidatePath(`/stock/${stockId}`)
}

/** Chart-Link eines Instruments (für die Trade-Detailseite). Null, wenn keiner. */
export async function getStockChartUrl(stockId: number): Promise<string | null> {
  const userId = await getUserId()
  const [row] = await db
    .select({ chartUrl: stock.chartUrl })
    .from(stock)
    .where(and(eq(stock.id, stockId), eq(stock.userId, userId)))
  return row?.chartUrl ?? null
}

/** Add an individual assessment (correct, wrong, or zone-not-reached) for a stock. */
export async function addAssessment(formData: {
  stockId: number
  isCorrect: boolean
  zoneNotReached?: boolean
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

  const zoneNotReached = formData.zoneNotReached ?? false

  await db.insert(assessment).values({
    userId,
    stockId: formData.stockId,
    // bei "nicht angelaufen" ist isCorrect bedeutungslos → false als Platzhalter
    isCorrect: zoneNotReached ? false : formData.isCorrect,
    zoneNotReached,
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
  zoneNotReached: boolean
  note: string | null
  assessmentDate: string // ISO date
}

export type StockDetail = {
  id: number
  name: string
  ticker: string
  market: string
  chartUrl: string | null
  createdAt: string // ISO date
  correct: number
  wrong: number
  notReached: number // Zone nicht angelaufen (neutral)
  total: number // entscheidungsrelevant = correct + wrong
  hitRate: number // 0-100
  timeline: TimelinePoint[]
  assessments: AssessmentEntry[]
}

/** Full detail for a single stock: stats, per-stock hit-rate timeline and all entries. */
export async function getStockDetail(
  stockId: number,
): Promise<StockDetail | null> {
  const userId = await getUserId()

  const [owned] = await selectStocksTolerant(
    and(eq(stock.id, stockId), eq(stock.userId, userId)),
  )

  if (!owned) return null

  const rows = await db
    .select()
    .from(assessment)
    .where(and(eq(assessment.stockId, stockId), eq(assessment.userId, userId)))
    .orderBy(asc(assessment.assessmentDate), asc(assessment.id))

  let correct = 0
  let wrong = 0
  let notReached = 0
  const timeline: TimelinePoint[] = []
  const assessments: AssessmentEntry[] = []

  for (const a of rows) {
    const d = new Date(a.assessmentDate)
    if (a.zoneNotReached) {
      // neutral: nicht in Trefferquote/Timeline, aber als Eintrag sichtbar
      notReached++
    } else {
      if (a.isCorrect) correct++
      else wrong++
      const total = correct + wrong
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
    }
    assessments.push({
      id: a.id,
      isCorrect: a.isCorrect,
      zoneNotReached: a.zoneNotReached,
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
    market: owned.market,
    chartUrl: owned.chartUrl,
    createdAt: new Date(owned.createdAt).toISOString(),
    correct,
    wrong,
    notReached,
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

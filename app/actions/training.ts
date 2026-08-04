'use server'

/**
 * Der Replay-Trainer (Phasen 3–5 des Trainer-Plans).
 *
 * Diese Datei lädt und schreibt nur — jede Entscheidung darüber, was gültig
 * ist, steht in `lib/training.ts`, jede Auswertung in `lib/training-stats.ts`.
 *
 * Die Reihenfolge ist die Leitplanke: `commitThesis` schreibt die These fest,
 * `saveResult` bewertet danach. Eine These lässt sich nach dem Festschreiben
 * nicht mehr ändern und eine Bewertung nicht überschreiben — sonst würde die
 * Übung nur die eigene Erinnerung bestätigen.
 *
 * ACHTUNG: `'use server'`-Dateien dürfen ausschließlich async Funktionen
 * exportieren. Alle Typen und Konstanten liegen deshalb in `lib/training.ts`.
 */

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  stock,
  trainingAnnotation,
  trainingResult,
  trainingSession,
  trainingTrade,
} from '@/lib/db/schema'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import {
  CHART_TIMEFRAME_IDS,
  intervalForTimeframe,
  isChartTimeframe,
} from '@/lib/chart-timeframes'
import { getSeriesCoverage } from '@/lib/market-data/candle-store'
import { summarizeCoverage } from '@/lib/market-data/candle-merge'
import { sanitizeSetupTags, serializeSetupTags, parseSetupTags } from '@/lib/setups'
import {
  MAX_ELLIOTT_LEN,
  MAX_NOTE_LEN,
  isBlindMode,
  isTrainingMode,
  isTrainingRating,
  isTrainingDirection,
  parseErrorTags,
  serializeErrorTags,
  trimText,
  validateThesis,
  type TrainingDirection,
  type TrainingMode,
  type TrainingRating,
  type TrainingStatus,
} from '@/lib/training'
import { computeTrainingStats, type TrainingRunRow, type TrainingStats } from '@/lib/training-stats'
import { clampStopEvery, isStopMode } from '@/lib/training-trade'
import type { DrawingPoint, DrawingType, Drawing } from '@/app/actions/drawings'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/** Die Übung, wie die Oberfläche sie braucht (Zeichnungen und Bewertung dabei). */
export async function getTrainingSession(id: number): Promise<{
  session: {
    id: number
    mode: TrainingMode
    blind: boolean
    /** Bei verdeckter, noch nicht aufgelöster Übung `null`. */
    symbol: string | null
    market: string | null
    timeframe: string
    stockId: number | null
    status: TrainingStatus
    candleCount: number
    startIndex: number
    startCandleTime: number | null
    direction: TrainingDirection | null
    elliottCount: string | null
    invalidation: number | null
    entryPrice: number | null
    stopLoss: number | null
    takeProfit: number | null
    thesisNote: string | null
    setupTags: string[]
    committedAt: Date | null
    revealedAt: Date | null
    createdAt: Date
    /** Ausbaustufe 2: wie der Replay anhält und ob die Sitzung beendet ist. */
    stopMode: string
    stopEvery: number
    endedAt: Date | null
  }
  annotations: Drawing[]
  result: {
    rating: TrainingRating
    errorTags: string[]
    note: string | null
    revealedCandles: number | null
    createdAt: Date
  } | null
} | null> {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(trainingSession)
    .where(and(eq(trainingSession.id, id), eq(trainingSession.userId, userId)))
  if (!row) return null

  const [annotationRows, resultRows] = await Promise.all([
    db
      .select()
      .from(trainingAnnotation)
      .where(
        and(eq(trainingAnnotation.sessionId, id), eq(trainingAnnotation.userId, userId)),
      )
      .orderBy(trainingAnnotation.id),
    db
      .select()
      .from(trainingResult)
      .where(and(eq(trainingResult.sessionId, id), eq(trainingResult.userId, userId))),
  ])

  const verdeckt = row.blind && row.revealedAt == null

  return {
    session: {
      id: row.id,
      mode: row.mode as TrainingMode,
      blind: row.blind,
      symbol: verdeckt ? null : row.symbol,
      market: verdeckt ? null : row.market,
      timeframe: row.timeframe,
      stockId: verdeckt ? null : row.stockId,
      status: row.status as TrainingStatus,
      candleCount: row.candleCount,
      startIndex: row.startIndex,
      startCandleTime: row.startCandleTime,
      direction: (row.direction as TrainingDirection | null) ?? null,
      elliottCount: row.elliottCount,
      invalidation: row.invalidation,
      entryPrice: row.entryPrice,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      thesisNote: row.thesisNote,
      setupTags: parseSetupTags(row.setupTags),
      committedAt: row.committedAt,
      revealedAt: row.revealedAt,
      createdAt: row.createdAt,
      stopMode: row.stopMode,
      stopEvery: row.stopEvery,
      endedAt: row.endedAt,
    },
    annotations: annotationRows.map((a) => ({
      id: a.id,
      type: a.type as DrawingType,
      points: JSON.parse(a.points) as DrawingPoint[],
      style: a.style ? JSON.parse(a.style) : null,
    })),
    result: resultRows[0]
      ? {
          rating: resultRows[0].rating as TrainingRating,
          errorTags: parseErrorTags(resultRows[0].errorTags),
          note: resultRows[0].note,
          revealedCandles: resultRows[0].revealedCandles,
          createdAt: resultRows[0].createdAt,
        }
      : null,
  }
}

/** Die letzten Übungen für die Liste unter dem Trainer. */
export async function listTrainingSessions(limit = 20): Promise<
  {
    id: number
    mode: TrainingMode
    symbol: string | null
    timeframe: string
    status: TrainingStatus
    rating: TrainingRating | null
    createdAt: Date
  }[]
> {
  const userId = await getUserId()
  const rows = await db
    .select({
      id: trainingSession.id,
      mode: trainingSession.mode,
      symbol: trainingSession.symbol,
      blind: trainingSession.blind,
      revealedAt: trainingSession.revealedAt,
      timeframe: trainingSession.timeframe,
      status: trainingSession.status,
      createdAt: trainingSession.createdAt,
      rating: trainingResult.rating,
    })
    .from(trainingSession)
    .leftJoin(trainingResult, eq(trainingResult.sessionId, trainingSession.id))
    .where(eq(trainingSession.userId, userId))
    .orderBy(desc(trainingSession.createdAt))
    .limit(Math.min(100, Math.max(1, limit)))

  return rows.map((r) => ({
    id: r.id,
    mode: r.mode as TrainingMode,
    symbol: r.blind && r.revealedAt == null ? null : r.symbol,
    timeframe: r.timeframe,
    status: r.status as TrainingStatus,
    rating: (r.rating as TrainingRating | null) ?? null,
    createdAt: r.createdAt,
  }))
}

/** Die Trainingsstatistik (Phase 5) — gerechnet wird in `lib/training-stats.ts`. */
export async function getTrainingStats(): Promise<TrainingStats> {
  const userId = await getUserId()

  // Seit Migration 0029 ist die Einheit der Auswertung der geübte TRADE, nicht
  // die Sitzung: Zehn Trades in einer Sitzung sind zehn Entscheidungen, und
  // eine Sitzung mit zehn Trades darf nicht so viel wiegen wie eine mit einem.
  //
  // Setup, Zeitebene und Modus kommen dabei weiter aus der Sitzung — der
  // Ausschnitt gehört ihr —, Bewertung und Fehler vom Trade.
  const tradeRows = await db
    .select({
      id: trainingTrade.id,
      sessionId: trainingTrade.sessionId,
      mode: trainingSession.mode,
      symbol: trainingSession.symbol,
      timeframe: trainingSession.timeframe,
      status: trainingSession.status,
      setupTags: trainingTrade.setupTags,
      rating: trainingTrade.rating,
      errorTags: trainingTrade.errorTags,
      ratedAt: trainingTrade.ratedAt,
    })
    .from(trainingTrade)
    .innerJoin(trainingSession, eq(trainingSession.id, trainingTrade.sessionId))
    .where(eq(trainingTrade.userId, userId))

  // Alt-Übungen aus der Zeit vor 0029: eine These, eine Bewertung. Sie zählen
  // unverändert weiter — als Sitzung mit genau einem Trade. Kein Backfill:
  // Ihre Daten werden nur gelesen, nie kopiert; eine Kopie liefe beim ersten
  // Ändern auseinander.
  const sessionRows = await db
    .select({
      id: trainingSession.id,
      mode: trainingSession.mode,
      symbol: trainingSession.symbol,
      timeframe: trainingSession.timeframe,
      setupTags: trainingSession.setupTags,
      status: trainingSession.status,
      rating: trainingResult.rating,
      errorTags: trainingResult.errorTags,
      ratedAt: trainingResult.createdAt,
    })
    .from(trainingSession)
    .leftJoin(trainingResult, eq(trainingResult.sessionId, trainingSession.id))
    .where(eq(trainingSession.userId, userId))

  // Eine Sitzung, die eigene Trades trägt, darf NICHT zusätzlich als eigene
  // Zeile zählen — sonst stünde sie doppelt in der Quote.
  const mitTrades = new Set(tradeRows.map((r) => r.sessionId))

  const runs: TrainingRunRow[] = [
    ...tradeRows
      // Abgebrochene Übungen zählen nirgends mit — sie sind kein Ergebnis.
      .filter((r) => r.status !== 'abgebrochen')
      .map((r) => ({
        id: r.id,
        mode: r.mode as TrainingMode,
        symbol: r.symbol,
        timeframe: r.timeframe,
        setupTags: parseSetupTags(r.setupTags),
        rating: isTrainingRating(r.rating) ? r.rating : null,
        errorTags: parseErrorTags(r.errorTags),
        ratedAt: r.ratedAt ?? null,
      })),
    ...sessionRows
      .filter((r) => r.status !== 'abgebrochen' && !mitTrades.has(r.id))
      .map((r) => ({
        // Negativ, damit sich die id-Räume von Sitzung und Trade nicht
        // überschneiden — die Auswertung nutzt sie als Schlüssel.
        id: -r.id,
        mode: r.mode as TrainingMode,
        symbol: r.symbol,
        timeframe: r.timeframe,
        setupTags: parseSetupTags(r.setupTags),
        rating: isTrainingRating(r.rating) ? r.rating : null,
        errorTags: parseErrorTags(r.errorTags),
        ratedAt: r.ratedAt ?? null,
      })),
  ]

  return computeTrainingStats(runs)
}

/**
 * Wie weit die gespeicherte Historie je Zeitebene reicht (Kerzenspeicher 0027).
 *
 * Gefragt wird über die eigenen, aufgelösten Instrumente — die Auskunft soll
 * sagen, was DIESER Nutzer üben kann, nicht was irgendwo in der Tabelle liegt.
 * Solange nichts gespeichert ist, steht überall eine ehrliche Null; der
 * Trainer schreibt dann, dass die Zahl erst mit dem ersten Abruf entsteht.
 */
export async function getTrainingCoverage(): Promise<
  { timeframe: string; days: number; symbols: number; candles: number }[]
> {
  const userId = await getUserId()

  const instrumente = await db
    .select({ symbol: stock.providerSymbol })
    .from(stock)
    .where(and(eq(stock.userId, userId), eq(stock.resolutionStatus, 'ok')))

  const symbole = [...new Set(instrumente.map((i) => i.symbol).filter((s): s is string => !!s))]
  const zeitebenen = CHART_TIMEFRAME_IDS
  const intervalle = zeitebenen.map((tf) => intervalForTimeframe(tf))

  const rows = symbole.length > 0 ? await getSeriesCoverage(symbole, intervalle) : []
  const summary = summarizeCoverage(rows, intervalle)

  return zeitebenen.map((tf, i) => {
    const treffer = summary.find((s) => s.interval === intervalle[i])
    return {
      timeframe: tf,
      days: treffer?.days ?? 0,
      symbols: treffer?.symbols ?? 0,
      candles: treffer?.candles ?? 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------

/**
 * Legt eine Übung an und gibt ihre Nummer zurück.
 *
 * Im Zufalls- und im Elliott-Modus zieht der Server das Instrument aus der
 * Watchlist — bewusst hier und nicht im Browser: Bei einer verdeckten Übung
 * darf die Seite gar nicht erst wissen, welches Papier sie zeigt.
 */
export async function startTrainingSession(input: {
  mode: string
  symbol?: string
  market?: string
  timeframe: string
  /** Haltepunkte: 'auto' (alle N Kerzen) oder 'manuell'. Siehe `lib/training-trade.ts`. */
  stopMode?: string
  stopEvery?: number
}): Promise<{ id: number } | { error: string }> {
  const userId = await getUserId()

  const mode: TrainingMode = isTrainingMode(input.mode) ? input.mode : 'frei'
  const timeframe = isChartTimeframe(input.timeframe) ? input.timeframe : '1h'

  let symbol = (input.symbol ?? '').trim().toUpperCase()
  let market = (input.market ?? 'aktien').trim()
  let stockId: number | null = null

  if (mode !== 'frei') {
    // Zufälliges Instrument aus der eigenen Watchlist. `random()` in der
    // Datenbank statt im Code: So wird nicht erst die ganze Liste geladen,
    // nur um eine Zeile zu behalten.
    const [gezogen] = await db
      .select({ id: stock.id, ticker: stock.ticker, market: stock.market })
      .from(stock)
      .where(eq(stock.userId, userId))
      .orderBy(sql`random()`)
      .limit(1)

    if (!gezogen) {
      return {
        error:
          'Für einen Zufallschart braucht es mindestens ein Instrument in der Watchlist.',
      }
    }
    symbol = gezogen.ticker.toUpperCase()
    market = gezogen.market
    stockId = gezogen.id
  } else {
    if (!symbol || symbol.length > 20) return { error: 'Bitte ein Symbol angeben.' }
    // Steht das Symbol in der Watchlist, hängen wir die Übung daran — nur mit
    // der Verknüpfung stimmt die Symbolauflösung (Etappe 11).
    const [treffer] = await db
      .select({ id: stock.id, market: stock.market })
      .from(stock)
      .where(and(eq(stock.userId, userId), eq(stock.ticker, symbol)))
      .limit(1)
    if (treffer) {
      stockId = treffer.id
      market = treffer.market
    }
  }

  const [row] = await db
    .insert(trainingSession)
    .values({
      userId,
      stockId,
      symbol,
      market,
      timeframe,
      mode,
      blind: isBlindMode(mode),
      status: 'offen',
      // Wie der Replay anhält, wird EINMAL beim Anlegen gewählt und gilt für
      // die ganze Sitzung — mitten im Durchlauf umzuschalten hieße, sich die
      // Übung passend zu machen.
      stopMode: isStopMode(input.stopMode) ? input.stopMode : 'auto',
      stopEvery: clampStopEvery(input.stopEvery),
    })
    .returning({ id: trainingSession.id })

  revalidatePath('/trainer')
  return { id: row.id }
}

/**
 * Trägt den geladenen Kerzenumfang und den gezogenen Startpunkt nach — einmal,
 * beim ersten Laden des Charts. Danach steht der Startpunkt fest: Wer ihn nach
 * dem Aufdecken noch verschieben könnte, würde sich die Übung passend machen.
 */
export async function registerTrainingCandles(input: {
  sessionId: number
  candleCount: number
  startIndex: number
  firstCandleTime: number | null
  startCandleTime: number | null
  lastCandleTime: number | null
}): Promise<{ ok: true; startIndex: number } | { error: string }> {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(trainingSession)
    .where(
      and(eq(trainingSession.id, input.sessionId), eq(trainingSession.userId, userId)),
    )
  if (!row) return { error: 'Trainingseinheit nicht gefunden.' }

  // Schon eingetragen (Seite neu geladen) → der gespeicherte Stand gilt.
  if (row.candleCount > 0) return { ok: true, startIndex: row.startIndex }

  const candleCount = Math.max(0, Math.floor(input.candleCount))
  const startIndex = Math.min(candleCount, Math.max(1, Math.floor(input.startIndex)))

  await db
    .update(trainingSession)
    .set({
      candleCount,
      startIndex,
      firstCandleTime: input.firstCandleTime,
      startCandleTime: input.startCandleTime,
      lastCandleTime: input.lastCandleTime,
    })
    .where(eq(trainingSession.id, input.sessionId))

  return { ok: true, startIndex }
}

// ---------------------------------------------------------------------------
// These festschreiben
// ---------------------------------------------------------------------------

export async function commitTrainingThesis(input: {
  sessionId: number
  direction: string
  elliottCount?: string | null
  invalidation?: number | null
  entryPrice?: number | null
  stopLoss?: number | null
  takeProfit?: number | null
  note?: string | null
  setupTags?: unknown
}): Promise<{ ok: true } | { error: string }> {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(trainingSession)
    .where(
      and(eq(trainingSession.id, input.sessionId), eq(trainingSession.userId, userId)),
    )
  if (!row) return { error: 'Trainingseinheit nicht gefunden.' }
  if (row.status !== 'offen') {
    return { error: 'Die These steht bereits fest und lässt sich nicht mehr ändern.' }
  }

  const zahl = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  const thesis = {
    direction: isTrainingDirection(input.direction) ? input.direction : 'keine',
    elliottCount: trimText(input.elliottCount, MAX_ELLIOTT_LEN),
    invalidation: zahl(input.invalidation),
    entryPrice: zahl(input.entryPrice),
    stopLoss: zahl(input.stopLoss),
    takeProfit: zahl(input.takeProfit),
    note: trimText(input.note, MAX_NOTE_LEN),
    setupTags: sanitizeSetupTags(input.setupTags),
  }

  const maengel = validateThesis(row.mode as TrainingMode, thesis)
  if (maengel.length > 0) return { error: maengel.join(' ') }

  await db
    .update(trainingSession)
    .set({
      direction: thesis.direction,
      elliottCount: thesis.elliottCount,
      invalidation: thesis.invalidation,
      entryPrice: thesis.entryPrice,
      stopLoss: thesis.stopLoss,
      takeProfit: thesis.takeProfit,
      thesisNote: thesis.note,
      setupTags: serializeSetupTags(thesis.setupTags),
      status: 'festgeschrieben',
      committedAt: new Date(),
    })
    .where(eq(trainingSession.id, input.sessionId))

  revalidatePath(`/trainer/${input.sessionId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Bewerten und auflösen
// ---------------------------------------------------------------------------

export async function saveTrainingResult(input: {
  sessionId: number
  rating: string
  errorTags?: unknown
  note?: string | null
  revealedCandles?: number | null
}): Promise<{ ok: true } | { error: string }> {
  const userId = await getUserId()
  const [row] = await db
    .select()
    .from(trainingSession)
    .where(
      and(eq(trainingSession.id, input.sessionId), eq(trainingSession.userId, userId)),
    )
  if (!row) return { error: 'Trainingseinheit nicht gefunden.' }
  if (row.status === 'offen') {
    return { error: 'Erst die These festschreiben, dann bewerten.' }
  }
  if (row.status === 'bewertet') {
    return { error: 'Diese Übung ist bereits bewertet.' }
  }
  if (!isTrainingRating(input.rating)) return { error: 'Bitte eine Bewertung wählen.' }

  const jetzt = new Date()
  await db.insert(trainingResult).values({
    sessionId: input.sessionId,
    userId,
    rating: input.rating,
    errorTags: serializeErrorTags(input.errorTags),
    note: trimText(input.note, MAX_NOTE_LEN),
    revealedCandles:
      typeof input.revealedCandles === 'number' && Number.isFinite(input.revealedCandles)
        ? Math.floor(input.revealedCandles)
        : null,
  })

  await db
    .update(trainingSession)
    .set({
      status: 'bewertet',
      finishedAt: jetzt,
      // Mit der Bewertung fällt der Vorhang — auch bei einer verdeckten Übung.
      revealedAt: row.revealedAt ?? jetzt,
    })
    .where(eq(trainingSession.id, input.sessionId))

  revalidatePath(`/trainer/${input.sessionId}`)
  revalidatePath('/trainer')
  revalidatePath('/trainer/statistik')
  return { ok: true }
}

/** Übung verwerfen — sie zählt danach in keiner Statistik mit. */
export async function abortTrainingSession(sessionId: number): Promise<{ ok: true }> {
  const userId = await getUserId()
  await db
    .update(trainingSession)
    .set({ status: 'abgebrochen', finishedAt: new Date() })
    .where(
      and(
        eq(trainingSession.id, sessionId),
        eq(trainingSession.userId, userId),
        // Eine bewertete Übung lässt sich nicht nachträglich wegwerfen.
        inArray(trainingSession.status, ['offen', 'festgeschrieben']),
      ),
    )
  revalidatePath('/trainer')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Zeichnungen der Übung
// ---------------------------------------------------------------------------

async function assertOwnSession(userId: string, sessionId: number) {
  const [own] = await db
    .select({ id: trainingSession.id })
    .from(trainingSession)
    .where(and(eq(trainingSession.id, sessionId), eq(trainingSession.userId, userId)))
  if (!own) throw new Error('Trainingseinheit nicht gefunden.')
}

export async function createTrainingAnnotation(input: {
  sessionId: number
  type: DrawingType
  points: DrawingPoint[]
  style?: Drawing['style']
}): Promise<Drawing> {
  const userId = await getUserId()
  await assertOwnSession(userId, input.sessionId)
  if (!Array.isArray(input.points) || input.points.length === 0) {
    throw new Error('Ungültige Punkte.')
  }

  const [row] = await db
    .insert(trainingAnnotation)
    .values({
      sessionId: input.sessionId,
      userId,
      type: input.type,
      points: JSON.stringify(input.points),
      style: input.style ? JSON.stringify(input.style) : null,
    })
    .returning()

  return {
    id: row.id,
    type: row.type as DrawingType,
    points: JSON.parse(row.points) as DrawingPoint[],
    style: row.style ? JSON.parse(row.style) : null,
  }
}

export async function updateTrainingAnnotation(input: {
  id: number
  points: DrawingPoint[]
}): Promise<void> {
  const userId = await getUserId()
  await db
    .update(trainingAnnotation)
    .set({ points: JSON.stringify(input.points) })
    .where(and(eq(trainingAnnotation.id, input.id), eq(trainingAnnotation.userId, userId)))
}

export async function deleteTrainingAnnotation(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(trainingAnnotation)
    .where(and(eq(trainingAnnotation.id, id), eq(trainingAnnotation.userId, userId)))
}

export async function deleteAllTrainingAnnotations(sessionId: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(trainingAnnotation)
    .where(
      and(
        eq(trainingAnnotation.sessionId, sessionId),
        eq(trainingAnnotation.userId, userId),
      ),
    )
}

'use server'

/**
 * Geübte Trades innerhalb einer Replay-Sitzung (Migration 0029).
 *
 * Diese Datei lädt, schreibt und MISST — jede Entscheidung darüber, was gültig
 * ist und wie gerechnet wird, steht in `lib/training-trade.ts`.
 *
 * Die Reihenfolge ist die Leitplanke, genau wie beim einstufigen Trainer:
 * `commitTrade` schreibt die These fest, danach läuft der Replay weiter,
 * `resolveTrade` misst aus den Kerzen, `rateTrade` ordnet ein. Eine
 * festgeschriebene These ist unveränderlich, ein gemessenes Ergebnis auch —
 * sonst bestätigt die Übung nur die eigene Erinnerung.
 *
 * GEMESSEN WIRD AUF DEM SERVER. Die Kerzen dafür kommen über denselben Weg wie
 * für den Chart (`getCachedCandles` + Symbolauflösung), nicht aus dem Browser:
 * Ein Ergebnis, das der Client mitschickt, ist kein Messwert, sondern eine
 * Behauptung.
 *
 * ACHTUNG: `'use server'` erlaubt ausschließlich async Funktionen als Export.
 * Typen und Konstanten liegen in `lib/training-trade.ts`.
 */

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trainingCheckpoint, trainingSession, trainingTrade } from '@/lib/db/schema'
import { and, asc, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { intervalForTimeframe } from '@/lib/chart-timeframes'
import { getCachedCandles } from '@/lib/market-data/cached'
import { createSymbolResolver, lookupProviderSymbol } from '@/lib/market-data/lookup'
import type { Market } from '@/lib/market-data/types'
import { parseSetupTags, sanitizeSetupTags, serializeSetupTags } from '@/lib/setups'
import { computeExcursion } from '@/lib/excursion'
import {
  MAX_ELLIOTT_LEN,
  MAX_NOTE_LEN,
  isTrainingDirection,
  isTrainingRating,
  parseErrorTags,
  serializeErrorTags,
  trimText,
  type TrainingDirection,
  type TrainingMode,
} from '@/lib/training'
import {
  MAX_SESSION_TRADES,
  computeInterventionCost,
  fortschrittZeit,
  isCheckpointDecision,
  measureOutcome,
  validateTradeDraft,
  type CheckpointDecision,
  type InterventionCost,
  type TrainingTradeView,
} from '@/lib/training-trade'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Die Sitzung des angemeldeten Nutzers — oder ein Fehler. Nie fremde Zeilen. */
async function loadSession(userId: string, sessionId: number) {
  const [row] = await db
    .select()
    .from(trainingSession)
    .where(and(eq(trainingSession.id, sessionId), eq(trainingSession.userId, userId)))
  if (!row) throw new Error('Übung nicht gefunden.')
  return row
}

function toView(r: typeof trainingTrade.$inferSelect): TrainingTradeView {
  return {
    id: r.id,
    seq: r.seq,
    direction: (isTrainingDirection(r.direction) ? r.direction : 'keine') as TrainingDirection,
    entryPrice: r.entryPrice,
    stopLoss: r.stopLoss,
    takeProfit: r.takeProfit,
    elliottCount: r.elliottCount,
    invalidation: r.invalidation,
    thesisNote: r.thesisNote,
    setupTags: parseSetupTags(r.setupTags),
    entryCandleTime: r.entryCandleTime,
    committedAt: r.committedAt,
    outcome:
      r.outcome === 'ziel' || r.outcome === 'stop' || r.outcome === 'offen' ? r.outcome : null,
    outcomeCandleTime: r.outcomeCandleTime,
    exitPrice: r.exitPrice,
    rMultiple: r.rMultiple,
    ambiguous: r.ambiguous,
    rating: isTrainingRating(r.rating) ? r.rating : null,
    errorTags: parseErrorTags(r.errorTags),
    note: r.note,
    ratedAt: r.ratedAt,
  }
}

/** Alle geübten Trades einer Sitzung, in der Reihenfolge des Übens. */
export async function listSessionTrades(sessionId: number): Promise<TrainingTradeView[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(trainingTrade)
    .where(and(eq(trainingTrade.sessionId, sessionId), eq(trainingTrade.userId, userId)))
    .orderBy(asc(trainingTrade.seq), asc(trainingTrade.id))
  return rows.map(toView)
}

/**
 * Eine These festschreiben — ab hier ist sie unveränderlich.
 *
 * `entryCandleTime` ist die letzte Kerze, die beim Festschreiben sichtbar war.
 * Sie ist zweierlei: der Beleg, dass die These vor dem Ergebnis stand, und der
 * Startpunkt der Messung. Der Client schickt sie mit, weil nur er weiß, wie
 * weit aufgedeckt ist — geprüft wird sie gegen die Kerzen der Übung, wenn
 * gemessen wird.
 */
export async function commitTrainingTrade(input: {
  sessionId: number
  direction: unknown
  entryPrice?: number | null
  stopLoss?: number | null
  takeProfit?: number | null
  elliottCount?: string | null
  invalidation?: number | null
  thesisNote?: string | null
  setupTags?: unknown
  entryCandleTime?: number | null
}): Promise<{ ok: true; trade: TrainingTradeView } | { ok: false; errors: string[] }> {
  const userId = await getUserId()
  const session = await loadSession(userId, input.sessionId)

  if (session.status === 'abgebrochen') {
    return { ok: false, errors: ['Diese Übung wurde verworfen.'] }
  }
  if (session.endedAt) {
    return { ok: false, errors: ['Diese Sitzung ist beendet.'] }
  }

  const [{ anzahl }] = await db
    .select({ anzahl: sql<number>`count(*)::int` })
    .from(trainingTrade)
    .where(eq(trainingTrade.sessionId, input.sessionId))
  if (anzahl >= MAX_SESSION_TRADES) {
    return { ok: false, errors: [`Höchstens ${MAX_SESSION_TRADES} Trades je Sitzung.`] }
  }

  const zahl = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  const draft = {
    direction: isTrainingDirection(input.direction) ? input.direction : null,
    entryPrice: zahl(input.entryPrice),
    stopLoss: zahl(input.stopLoss),
    takeProfit: zahl(input.takeProfit),
    elliottCount: trimText(input.elliottCount, MAX_ELLIOTT_LEN),
    invalidation: zahl(input.invalidation),
    thesisNote: trimText(input.thesisNote, MAX_NOTE_LEN),
    setupTags: sanitizeSetupTags(input.setupTags),
  }

  // Dieselbe Prüfung wie im Formular — der Client ist keine Prüfstelle.
  const errors = validateTradeDraft(draft, session.mode as TrainingMode)
  if (errors.length > 0) return { ok: false, errors }

  const [row] = await db
    .insert(trainingTrade)
    .values({
      sessionId: input.sessionId,
      userId,
      seq: anzahl + 1,
      direction: draft.direction!,
      entryPrice: draft.entryPrice,
      stopLoss: draft.stopLoss,
      takeProfit: draft.takeProfit,
      elliottCount: draft.elliottCount,
      invalidation: draft.invalidation,
      thesisNote: draft.thesisNote,
      setupTags: serializeSetupTags(draft.setupTags),
      entryCandleTime: zahl(input.entryCandleTime),
    })
    .returning()

  // Die Sitzung gilt ab dem ersten Trade als festgeschrieben — ab da gibt der
  // Replay Kerzen frei.
  if (session.status === 'offen') {
    await db
      .update(trainingSession)
      .set({ status: 'festgeschrieben', committedAt: session.committedAt ?? new Date() })
      .where(eq(trainingSession.id, input.sessionId))
  }

  revalidatePath(`/trainer/${input.sessionId}`)
  return { ok: true, trade: toView(row) }
}

/**
 * Das Ergebnis eines Trades aus den Kerzen messen und festschreiben.
 *
 * Wird nur einmal geschrieben: Ein bereits gemessenes Ergebnis bleibt stehen,
 * auch wenn später mehr Historie vorliegt — sonst änderte sich rückwirkend,
 * was in der Statistik steht.
 */
export async function resolveTrainingTrade(input: {
  sessionId: number
  tradeId: number
}): Promise<
  { ok: true; trade: TrainingTradeView } | { ok: false; reason: string }
> {
  const userId = await getUserId()
  const session = await loadSession(userId, input.sessionId)

  const [row] = await db
    .select()
    .from(trainingTrade)
    .where(and(eq(trainingTrade.id, input.tradeId), eq(trainingTrade.userId, userId)))
  if (!row) return { ok: false, reason: 'Trade nicht gefunden.' }
  if (row.outcome) return { ok: true, trade: toView(row) }
  if (row.direction === 'keine') return { ok: false, reason: 'Eine Enthaltung wird nicht gemessen.' }
  if (row.entryPrice == null || row.stopLoss == null || row.takeProfit == null) {
    return { ok: false, reason: 'Ohne Einstieg, Stop und Ziel ist nichts zu messen.' }
  }
  if (row.entryCandleTime == null) {
    return { ok: false, reason: 'Der Startpunkt der Messung fehlt.' }
  }

  // Kerzen über denselben Weg wie der Chart: Rohticker → Anbieter-Symbol über
  // das verknüpfte Instrument (Etappe 11), nie den Ticker direkt fragen.
  const providerSymbol = session.stockId
    ? (await createSymbolResolver(userId))(session.symbol, session.stockId)
    : (await lookupProviderSymbol(userId, session.symbol)).symbol
  const candles = await getCachedCandles(
    providerSymbol,
    session.market as Market,
    intervalForTimeframe(session.timeframe),
    { limit: 5000 },
  )

  const messung = measureOutcome(
    {
      direction: row.direction as TrainingDirection,
      entryPrice: row.entryPrice,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
    },
    candles,
    row.entryCandleTime,
  )
  if (!messung) return { ok: false, reason: 'Für diesen Zeitraum liegen keine Kerzen vor.' }

  const [updated] = await db
    .update(trainingTrade)
    .set({
      outcome: messung.outcome,
      outcomeCandleTime: messung.atTime,
      exitPrice: messung.exitPrice,
      rMultiple: messung.rMultiple,
      ambiguous: messung.ambiguous,
    })
    .where(eq(trainingTrade.id, row.id))
    .returning()

  revalidatePath(`/trainer/${input.sessionId}`)
  return { ok: true, trade: toView(updated) }
}

/**
 * Die eigene Einordnung zu einem Trade — nach dem Aufdecken.
 *
 * Getrennt vom gemessenen Ergebnis, weil beides verschiedene Fragen beantwortet:
 * Das Ergebnis sagt, ob Stop oder Ziel kam; die Bewertung sagt, ob die ANALYSE
 * gestimmt hat. Ein Trade kann sein Ziel erreichen und die Zählung trotzdem
 * falsch gewesen sein.
 */
export async function rateTrainingTrade(input: {
  sessionId: number
  tradeId: number
  rating: unknown
  errorTags?: unknown
  note?: string | null
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await getUserId()
  if (!isTrainingRating(input.rating)) return { ok: false, reason: 'Bewertung fehlt.' }

  const [row] = await db
    .select({ id: trainingTrade.id, ratedAt: trainingTrade.ratedAt })
    .from(trainingTrade)
    .where(and(eq(trainingTrade.id, input.tradeId), eq(trainingTrade.userId, userId)))
  if (!row) return { ok: false, reason: 'Trade nicht gefunden.' }
  if (row.ratedAt) return { ok: false, reason: 'Dieser Trade ist bereits bewertet.' }

  await db
    .update(trainingTrade)
    .set({
      rating: input.rating,
      errorTags: serializeErrorTags(input.errorTags),
      note: trimText(input.note, MAX_NOTE_LEN),
      ratedAt: new Date(),
    })
    .where(eq(trainingTrade.id, row.id))

  revalidatePath(`/trainer/${input.sessionId}`)
  revalidatePath('/trainer/statistik')
  return { ok: true }
}

/**
 * Einen Haltepunkt festhalten.
 *
 * Auch — und gerade — die Zeilen ohne Trade: Sie zählen, wie oft hingesehen und
 * bewusst nichts gemacht wurde. Ohne sie wäre Überhandeln nicht messbar.
 */
export async function logTrainingCheckpoint(input: {
  sessionId: number
  tradeId?: number | null
  candleTime?: number | null
  decision: unknown
  note?: string | null
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const userId = await getUserId()
  await loadSession(userId, input.sessionId)
  if (!isCheckpointDecision(input.decision)) {
    return { ok: false, reason: 'Unbekannte Entscheidung.' }
  }

  await db.insert(trainingCheckpoint).values({
    sessionId: input.sessionId,
    userId,
    tradeId: input.tradeId ?? null,
    candleTime:
      typeof input.candleTime === 'number' && Number.isFinite(input.candleTime)
        ? input.candleTime
        : null,
    decision: input.decision,
    note: trimText(input.note, MAX_NOTE_LEN),
  })

  return { ok: true }
}

/**
 * Wo die Sitzung stehen geblieben ist.
 *
 * Der Replay-Fortschritt lag bis hierher ausschließlich im Browser. Ein F5
 * warf die Sitzung damit zurück vor die erste Entscheidung — der Replay war
 * wieder gesperrt, und eine erneut gegebene Antwort „kein Setup" landete ein
 * ZWEITES Mal in `training_checkpoint`. Genau die Zahl gegen das Überhandeln
 * wurde so durch ein Neuladen nach oben verfälscht.
 *
 * Zurückgegeben wird die ZEIT der zuletzt gesehenen Kerze, nicht ein Index:
 * dieselbe Entscheidung wie beim Startpunkt der Übung (der Kerzenspeicher
 * wächst, ein Index gilt nur in seinem eigenen Satz).
 *
 * Quellen sind ausschließlich Dinge, die der Nutzer nachweislich schon vor
 * sich hatte — beantwortete Haltepunkte und die Einstiege der geübten Trades.
 * Ergebniszeiten bleiben bewusst draußen: Sie können aus der Schlussmessung
 * über die volle Historie stammen und würden Zukunft aufdecken.
 */
export async function getSessionProgress(sessionId: number): Promise<{
  letzteKerzenzeit: number | null
  antworten: number
}> {
  const userId = await getUserId()
  await loadSession(userId, sessionId)

  const punkte = await db
    .select({ candleTime: trainingCheckpoint.candleTime })
    .from(trainingCheckpoint)
    .where(
      and(eq(trainingCheckpoint.sessionId, sessionId), eq(trainingCheckpoint.userId, userId)),
    )

  const trades = await db
    .select({ entryCandleTime: trainingTrade.entryCandleTime })
    .from(trainingTrade)
    .where(and(eq(trainingTrade.sessionId, sessionId), eq(trainingTrade.userId, userId)))

  return {
    letzteKerzenzeit: fortschrittZeit([
      ...punkte.map((p) => p.candleTime),
      ...trades.map((t) => t.entryCandleTime),
    ]),
    antworten: punkte.length,
  }
}

/**
 * Die Rückschau auf eine Sitzung: bewusste Enthaltungen und die Kosten des
 * eigenen Eingreifens.
 *
 * Beides steckt in denselben Haltepunkt-Zeilen und ist der eigentliche Ertrag
 * der Übung — ohne diese Auswertung wäre `training_checkpoint` eine Tabelle,
 * die mitschreibt und nie jemandem etwas sagt.
 */
export async function getSessionReview(sessionId: number): Promise<{
  checkpoints: number
  keinSetup: number
  eingriff: InterventionCost
  /**
   * Wie weit der Kurs während der Haltedauer gegen dich lief (MAE) und wie weit
   * für dich (MFE), je in R — gemittelt über die entschiedenen Trades.
   *
   * Beantwortet die Frage, die sonst Gefühlssache bleibt: „War mein Stop zu
   * eng?" Wenn die Verlierer im Schnitt 0,4 R gegen dich liefen und trotzdem
   * ausgestoppt wurden, lag es am Stop; liefen sie 1,0 R, lag es an der These.
   * `null`, solange nichts messbar ist.
   */
  excursion: { maeR: number; mfeR: number; trades: number } | null
}> {
  const userId = await getUserId()
  const [rows, trades] = await Promise.all([
    db
      .select({
        tradeId: trainingCheckpoint.tradeId,
        decision: trainingCheckpoint.decision,
      })
      .from(trainingCheckpoint)
      .where(
        and(
          eq(trainingCheckpoint.sessionId, sessionId),
          eq(trainingCheckpoint.userId, userId),
        ),
      ),
    db
      .select()
      .from(trainingTrade)
      .where(
        and(eq(trainingTrade.sessionId, sessionId), eq(trainingTrade.userId, userId)),
      ),
  ])

  // MAE/MFE über dieselben Kerzen wie die Messung. Bewusst live gerechnet und
  // nicht gespeichert: Es sind abgeleitete Werte aus unveränderlichen Daten
  // (Plan + Kerzen) — eine Spalte dafür wäre eine zweite Wahrheit, die beim
  // ersten Nachladen von Historie auseinanderliefe.
  let excursion: { maeR: number; mfeR: number; trades: number } | null = null
  const messbar = trades.filter(
    (t) =>
      t.direction !== 'keine' &&
      t.outcome != null &&
      t.entryPrice != null &&
      t.stopLoss != null &&
      t.entryCandleTime != null &&
      t.outcomeCandleTime != null,
  )

  if (messbar.length > 0) {
    try {
      const session = await loadSession(userId, sessionId)
      const providerSymbol = session.stockId
        ? (await createSymbolResolver(userId))(session.symbol, session.stockId)
        : (await lookupProviderSymbol(userId, session.symbol)).symbol
      const candles = await getCachedCandles(
        providerSymbol,
        session.market as Market,
        intervalForTimeframe(session.timeframe),
        { limit: 5000 },
      )

      let mae = 0
      let mfe = 0
      let gezaehlt = 0
      for (const t of messbar) {
        const run = computeExcursion(
          {
            direction: t.direction as 'long' | 'short',
            entryPrice: t.entryPrice!,
            riskDistance: Math.abs(t.entryPrice! - t.stopLoss!),
            fromSec: t.entryCandleTime!,
            toSec: t.outcomeCandleTime!,
          },
          candles,
        )
        if (!run.measured) continue
        mae += run.maeR
        mfe += run.mfeR
        gezaehlt++
      }
      if (gezaehlt > 0) {
        excursion = { maeR: mae / gezaehlt, mfeR: mfe / gezaehlt, trades: gezaehlt }
      }
    } catch {
      // Ohne Kerzen bleibt die Rückschau stehen — sie ist Beiwerk, keine
      // Voraussetzung für die Bilanz.
    }
  }

  const punkte = rows
    .filter((r) => isCheckpointDecision(r.decision))
    .map((r) => ({ tradeId: r.tradeId, decision: r.decision as CheckpointDecision }))

  return {
    checkpoints: rows.length,
    keinSetup: rows.filter((r) => r.decision === 'kein_setup').length,
    excursion,
    eingriff: computeInterventionCost(
      trades.map((t) => ({
        id: t.id,
        outcome:
          t.outcome === 'ziel' || t.outcome === 'stop' || t.outcome === 'offen'
            ? t.outcome
            : null,
        rMultiple: t.rMultiple,
      })),
      punkte,
    ),
  }
}

/**
 * Das eigene Verhalten über ALLE Übungen — die Serie, nicht der Einzelfall.
 *
 * Eine einzelne Sitzung zeigt Zufall: Zwei Trades, einer geht auf, das sagt
 * nichts. Erst über zwanzig Trades wird sichtbar, ob man regelmäßig zu früh
 * aussteigt oder regelmäßig Setups sieht, wo keine sind. Genau dafür sind die
 * Haltepunkte da — hier werden sie zum ersten Mal über Sitzungen hinweg
 * gelesen.
 *
 * Bewusst getrennt von `getTrainingStats`: Dort geht es um die **Analyse**
 * (war die These richtig), hier um das **Verhalten** (hast du sie gehandelt).
 */
export async function getTrainingBehaviour(): Promise<{
  eingriff: InterventionCost
  /** Haltepunkte insgesamt und wie oft dabei bewusst nichts gemacht wurde. */
  checkpoints: number
  keinSetup: number
  /** Geübte Trades mit Ergebnis — die Grundlage jeder Zahl hier. */
  entschieden: number
  /** Bewusste Enthaltungen beim Planen („Kein Setup" statt eines Trades). */
  enthaltungen: number
}> {
  const userId = await getUserId()
  const [punkte, trades] = await Promise.all([
    db
      .select({
        tradeId: trainingCheckpoint.tradeId,
        decision: trainingCheckpoint.decision,
      })
      .from(trainingCheckpoint)
      .where(eq(trainingCheckpoint.userId, userId)),
    db
      .select({
        id: trainingTrade.id,
        direction: trainingTrade.direction,
        outcome: trainingTrade.outcome,
        rMultiple: trainingTrade.rMultiple,
      })
      .from(trainingTrade)
      .where(eq(trainingTrade.userId, userId)),
  ])

  return {
    checkpoints: punkte.length,
    keinSetup: punkte.filter((p) => p.decision === 'kein_setup').length,
    entschieden: trades.filter((t) => t.direction !== 'keine' && t.outcome != null).length,
    enthaltungen: trades.filter((t) => t.direction === 'keine').length,
    eingriff: computeInterventionCost(
      trades.map((t) => ({
        id: t.id,
        outcome:
          t.outcome === 'ziel' || t.outcome === 'stop' || t.outcome === 'offen'
            ? t.outcome
            : null,
        rMultiple: t.rMultiple,
      })),
      punkte
        .filter((p) => isCheckpointDecision(p.decision))
        .map((p) => ({ tradeId: p.tradeId, decision: p.decision as CheckpointDecision })),
    ),
  }
}

/**
 * Die Sitzung beenden. Das Ende bestimmt der Nutzer — die App hält nur an und
 * fragt, wenn ein Trade entschieden ist.
 *
 * Noch nicht gemessene Trades werden hier ein letztes Mal gemessen: Sonst
 * fehlte ein Ergebnis nur deshalb, weil niemand mehr auf „auflösen" geklickt
 * hat.
 */
export async function endTrainingSession(
  sessionId: number,
): Promise<{ ok: true; gemessen: number }> {
  const userId = await getUserId()
  await loadSession(userId, sessionId)

  const offene = await db
    .select({ id: trainingTrade.id })
    .from(trainingTrade)
    .where(
      and(
        eq(trainingTrade.sessionId, sessionId),
        eq(trainingTrade.userId, userId),
        sql`${trainingTrade.outcome} is null`,
        sql`${trainingTrade.direction} <> 'keine'`,
      ),
    )

  let gemessen = 0
  for (const t of offene) {
    const res = await resolveTrainingTrade({ sessionId, tradeId: t.id })
    if (res.ok) gemessen++
  }

  await db
    .update(trainingSession)
    .set({ endedAt: new Date(), status: 'bewertet', revealedAt: new Date() })
    .where(eq(trainingSession.id, sessionId))

  revalidatePath(`/trainer/${sessionId}`)
  revalidatePath('/trainer')
  revalidatePath('/trainer/statistik')
  return { ok: true, gemessen }
}

'use server'

// MAE/MFE (Etappe 7c) — die Datenseite für die Trade-Detailseite.
//
// Die Auswertung auf /tracking läuft im Bot-Zwilling-Durchlauf mit
// (`app/actions/bot-twin.ts` → `measureExcursion`), damit kein Symbol zweimal
// abgerufen wird. Hier geht es um genau EINEN Trade: die Messung für seine
// Karte und der Nachtrag von Hand.
//
// Gemessen wird live über den Kerzen-Cache, gespeichert wird nur der Nachtrag.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trade, tradeEvent, tradeExcursion } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createCandleLoader } from '@/lib/market-data/candle-loader'
import { tradeRMultiple, type TradeRow } from '@/lib/trade-stats'
import type { ExcursionEntry } from '@/lib/excursion'
import { measureExcursion } from '@/app/actions/bot-twin'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function loadOwnedTrade(userId: string, id: number): Promise<TradeRow> {
  const [row] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, id), eq(trade.userId, userId)))
  if (!row) throw new Error('Trade nicht gefunden.')
  return row
}

/** Postgres „undefined table" (42P01) — Migration 0017 noch nicht angewendet. */
function isMissingTable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; cause?: { code?: string }; message?: string }
  return e.code === '42P01' || e.cause?.code === '42P01' || /trade_excursion/.test(e.message ?? '')
}

/**
 * MAE/MFE eines einzelnen Trades für die Detailseite.
 *
 * Gibt `null` zurück, solange der Trade nicht entschieden ist: vor dem Abschluss
 * gibt es kein Fenster, das man messen könnte, und keinen Ausstieg, gegen den
 * sich der Mitlauf vergleichen ließe.
 */
export async function getTradeExcursion(tradeId: number): Promise<ExcursionEntry | null> {
  const userId = await getUserId()
  const t = await loadOwnedTrade(userId, tradeId)
  if (t.result !== 'gewinn' && t.result !== 'verlust') return null

  const events = await db
    .select()
    .from(tradeEvent)
    .where(and(eq(tradeEvent.tradeId, tradeId), eq(tradeEvent.userId, userId)))

  let manual = null
  try {
    const [row] = await db
      .select()
      .from(tradeExcursion)
      .where(and(eq(tradeExcursion.tradeId, tradeId), eq(tradeExcursion.userId, userId)))
    if (row) manual = { worstPrice: row.worstPrice, bestPrice: row.bestPrice }
  } catch (err) {
    if (!isMissingTable(err)) throw err
  }

  return measureExcursion(t, {
    label: (t.closedAt ?? t.createdAt).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }),
    realR: tradeRMultiple(t, events),
    load: createCandleLoader(),
    manual,
  })
}

/**
 * Extremkurse von Hand nachtragen.
 *
 * Eingetragen werden **Kurse**, keine R-Werte — ablesbar am Chart, umgerechnet
 * wird daraus. Eine saubere Messung bleibt trotzdem vorne (siehe `resolveRun`);
 * der Nachtrag greift bei fehlenden Kursdaten und bei einer Kerze, die länger
 * ist als der Trade selbst.
 */
export async function setTradeExcursion(
  tradeId: number,
  data: { worstPrice?: number | null; bestPrice?: number | null; note?: string | null },
): Promise<void> {
  const userId = await getUserId()
  await loadOwnedTrade(userId, tradeId) // Autorisierung

  const clean = (v: number | null | undefined): number | null =>
    v == null || !Number.isFinite(v) || v <= 0 ? null : v
  const worstPrice = clean(data.worstPrice)
  const bestPrice = clean(data.bestPrice)
  if (worstPrice === null && bestPrice === null) {
    throw new Error('Bitte mindestens einen der beiden Kurse angeben.')
  }

  const note = data.note?.trim() || null
  const now = new Date()

  await db
    .insert(tradeExcursion)
    .values({ tradeId, userId, worstPrice, bestPrice, note })
    .onConflictDoUpdate({
      target: [tradeExcursion.tradeId, tradeExcursion.userId],
      set: { worstPrice, bestPrice, note, updatedAt: now },
    })

  revalidatePath('/trades')
  revalidatePath('/tracking')
}

/** Einen Nachtrag wieder entfernen — danach zählt wieder allein die Messung. */
export async function clearTradeExcursion(tradeId: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(tradeExcursion)
    .where(and(eq(tradeExcursion.tradeId, tradeId), eq(tradeExcursion.userId, userId)))

  revalidatePath('/trades')
  revalidatePath('/tracking')
}

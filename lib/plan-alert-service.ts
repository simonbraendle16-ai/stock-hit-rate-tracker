import { db } from '@/lib/db'
import { priceAlert, trade, tradeTarget } from '@/lib/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getCachedQuote } from '@/lib/market-data/quote'
import { MarketDataError, type Market } from '@/lib/market-data'
import { createSymbolResolver } from '@/lib/market-data/lookup'
import { runAlertCheck } from '@/lib/alert-run'
import {
  directionForLevel,
  isAlertDirection,
  isAlertKind,
  isLevelReached,
  type AlertDirection,
  type AlertKind,
  type AlertView,
  type CreateAlertInput,
} from '@/lib/alerts'


async function tryQuote(symbol: string, market: Market) {
  try {
    return await getCachedQuote(symbol, market)
  } catch (err) {
    // rate_limit / unsupported / unknown_symbol / Netz — der Aufrufer entscheidet,
    // ob das ein harter Fehler ist (Anlegen) oder still übersprungen wird (Check).
    if (err instanceof MarketDataError) return null
    return null
  }
}

export async function createPlanAlertsForUser(
  userId: string,
  tradeId: number,
  // Etappe 14: Welche Arten gesetzt werden sollen. Ohne Angabe alle — so
  // verhalten sich alle bisherigen Aufrufer unverändert.
  //
  // Der Ablauf ist bewusst zweistufig: Beim ANLEGEN wird nur der Einstieg
  // geweckt, denn Stop und Ziel gehören zu einer Position, die es noch nicht
  // gibt. Ein „Stop erreicht" ohne Position wäre eine Meldung über nichts — und
  // ein Warnsystem verliert seine Wirkung in dem Moment, in dem es anfängt,
  // Belangloses zu melden. Beim AKTIVIEREN kommen Stop und Ziele dazu.
  opts?: { kinds?: AlertKind[] },
): Promise<{ created: number }> {
  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))
  if (!t) throw new Error('Trade nicht gefunden.')

  // Wer die Wecker für diesen Trade abgeschaltet hat, bekommt auch dann keine,
  // wenn ein automatischer Weg sie anlegen würde.
  if (!t.alertsEnabled) return { created: 0 }

  const resolvePlanSymbol = await createSymbolResolver(userId)
  const quote = await tryQuote(
    resolvePlanSymbol(t.ticker, t.stockId),
    t.market as Market,
  )
  const reference = quote?.price ?? t.entryPrice

  // Bereits gesetzte, noch aktive Plan-Alerts dieses Trades — nicht doppeln.
  const existing = await db
    .select({ kind: priceAlert.kind, price: priceAlert.price })
    .from(priceAlert)
    .where(
      and(
        eq(priceAlert.userId, userId),
        eq(priceAlert.tradeId, tradeId),
        eq(priceAlert.active, true),
      ),
    )
  // Schlüssel ist Art UND Level: Ein Trade mit drei Zielstufen hat drei
  // Ziel-Alerts, und keiner davon darf den anderen als „schon da" verdrängen.
  const already = new Set(existing.map((e) => `${e.kind}@${e.price}`))

  // Teilziele lösen den einen Ziel-Alert ab; ohne sie bleibt es beim Feld.
  const stufen = await db
    .select({ price: tradeTarget.price, executedAt: tradeTarget.executedAt })
    .from(tradeTarget)
    .where(and(eq(tradeTarget.tradeId, tradeId), eq(tradeTarget.userId, userId)))
    .orderBy(asc(tradeTarget.sortOrder))

  const ziele =
    stufen.length > 0
      ? // Erreichte Stufen brauchen keinen Wecker mehr.
        stufen.filter((s) => s.executedAt == null).map((s) => s.price)
      : t.takeProfit != null
        ? [t.takeProfit]
        : []

  const alleLevels: { kind: AlertKind; level: number | null }[] = [
    { kind: 'einstieg', level: t.entryPrice },
    { kind: 'stop', level: t.stopLoss },
    ...ziele.map((p) => ({ kind: 'ziel' as AlertKind, level: p })),
  ]
  const gewuenscht = opts?.kinds
  const levels = gewuenscht ? alleLevels.filter((l) => gewuenscht.includes(l.kind)) : alleLevels

  const rows: (typeof priceAlert.$inferInsert)[] = []
  for (const { kind, level } of levels) {
    if (level == null || already.has(`${kind}@${level}`)) continue
    const direction = directionForLevel(level, reference)
    if (!direction) continue // Level == Bezug (z. B. Einstieg ohne Kurs) → auslassen
    // Schon erfüllt? Dann wäre der Alert sofort ausgelöst — überspringen.
    if (quote && isLevelReached(direction, level, quote.price)) continue
    rows.push({
      userId,
      stockId: t.stockId ?? null,
      tradeId: t.id,
      ticker: t.ticker,
      market: t.market,
      price: level,
      direction,
      kind,
      note: null,
    })
  }

  if (rows.length) {
    await db.insert(priceAlert).values(rows)
    revalidatePath('/')
  }
  return { created: rows.length }
}

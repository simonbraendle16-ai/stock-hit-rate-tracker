'use server'

// Kurs-Alerts (Etappe 3). Eigene Ebene neben den Trade-Actions: alle Zugriffe
// filtern hart auf `getUserId()` — kein bestehender Datenpfad wird aufgebohrt.
//
// Rechenlogik (Auslösen, Richtungswahl) liegt in `lib/alerts.ts` (rein, getestet);
// hier werden nur Zeilen geladen, geschrieben und der Kurs abgerufen. Typen und
// Konstanten kommen ebenfalls von dort — eine 'use server'-Datei darf keine
// exportieren.

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { priceAlert, trade } from '@/lib/db/schema'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getCachedQuote } from '@/lib/market-data/quote'
import { MarketDataError, type Market } from '@/lib/market-data'
import {
  candleReachesLevel,
  directionForLevel,
  isAlertDirection,
  isAlertKind,
  isLevelReached,
  type AlertDirection,
  type AlertKind,
  type AlertView,
  type CreateAlertInput,
} from '@/lib/alerts'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

const VALID_MARKETS: readonly Market[] = [
  'aktien',
  'krypto',
  'forex',
  'rohstoffe',
  'etf',
  'optionen',
  'sonstiges',
]

type AlertRow = typeof priceAlert.$inferSelect

/** Datenbankzeile → serialisierbare Sicht für den Client. */
function toView(a: AlertRow): AlertView {
  return {
    id: a.id,
    ticker: a.ticker,
    market: a.market,
    price: a.price,
    direction: (isAlertDirection(a.direction) ? a.direction : 'above'),
    kind: (isAlertKind(a.kind) ? a.kind : 'manuell'),
    note: a.note,
    active: a.active,
    triggeredAt: a.triggeredAt ? new Date(a.triggeredAt).toISOString() : null,
    createdAt: new Date(a.createdAt).toISOString(),
    tradeId: a.tradeId,
    stockId: a.stockId,
  }
}

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase()
}

function normalizeMarket(raw: string | null | undefined): Market {
  const m = (raw ?? 'aktien') as Market
  return VALID_MARKETS.includes(m) ? m : 'aktien'
}

/** Kurs holen, aber niemals daran scheitern — `null`, wenn er gerade nicht abrufbar ist. */
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

// ---------------------------------------------------------------------------
// Anlegen
// ---------------------------------------------------------------------------

/**
 * Einen Alert setzen. Die Richtung wird — wenn nicht angegeben — aus dem
 * aktuellen Kurs bestimmt: ein Level über dem Kurs ist ein 'above'-Alert, eines
 * darunter 'below'. Ein Level, das der Kurs bereits erreicht hat, wird abgelehnt
 * (statt sofort auszulösen — das wäre kein „setzen und weggehen").
 */
export async function createAlert(input: CreateAlertInput): Promise<AlertView> {
  const userId = await getUserId()
  const ticker = normalizeSymbol(input.ticker)
  const market = normalizeMarket(input.market)

  if (!ticker) throw new Error('Ticker ist erforderlich.')
  if (!Number.isFinite(input.price) || input.price <= 0) {
    throw new Error('Bitte ein gültiges Kurslevel größer als 0 angeben.')
  }

  const quote = await tryQuote(ticker, market)

  let direction: AlertDirection
  if (isAlertDirection(input.direction)) {
    direction = input.direction
  } else {
    if (!quote) {
      throw new Error(
        'Kurs gerade nicht abrufbar — bitte die Richtung (über/unter) selbst angeben oder später erneut versuchen.',
      )
    }
    const derived = directionForLevel(input.price, quote.price)
    if (!derived) {
      throw new Error('Das Level entspricht dem aktuellen Kurs — bitte etwas darüber oder darunter wählen.')
    }
    direction = derived
  }

  // Bereits erfüllt? Nur ablehnen, wenn wir den Kurs tatsächlich kennen.
  if (quote && isLevelReached(direction, input.price, quote.price)) {
    throw new Error(
      `Der Kurs (${quote.price}) hat dieses Level bereits erreicht — bitte ein Level auf der noch offenen Seite wählen.`,
    )
  }

  const kind: AlertKind = isAlertKind(input.kind) ? input.kind : 'manuell'

  const [row] = await db
    .insert(priceAlert)
    .values({
      userId,
      stockId: input.stockId ?? null,
      tradeId: input.tradeId ?? null,
      ticker,
      market,
      price: input.price,
      direction,
      kind,
      note: input.note?.trim() || null,
    })
    .returning()

  revalidatePath('/')
  return toView(row)
}

/**
 * Aus einem Trade-Plan bis zu drei Alerts ableiten: Stop erreicht, Ziel erreicht
 * und — sofern ein aktueller Kurs vorliegt — Einstieg erreicht. Genau die Punkte,
 * an denen ein disziplinierter Trader etwas tun muss.
 *
 * Richtung je Level aus der Geometrie: Bezug ist der aktuelle Kurs, ersatzweise
 * der Einstieg. Ohne Kurs ist die Einstiegs-Richtung nicht bestimmbar (Level ==
 * Bezug) und wird ausgelassen — Stop und Ziel liegen dagegen immer eindeutig auf
 * je einer Seite des Einstiegs. Bereits erfüllte Level (Kurs schon jenseits) und
 * bereits vorhandene Alerts derselben Art werden übersprungen, damit ein
 * erneuter Aufruf nichts doppelt.
 */
export async function createPlanAlerts(tradeId: number): Promise<{ created: number }> {
  const userId = await getUserId()
  const [t] = await db
    .select()
    .from(trade)
    .where(and(eq(trade.id, tradeId), eq(trade.userId, userId)))
  if (!t) throw new Error('Trade nicht gefunden.')

  const quote = await tryQuote(t.ticker, t.market as Market)
  const reference = quote?.price ?? t.entryPrice

  // Bereits gesetzte, noch aktive Plan-Alerts dieses Trades — nicht doppeln.
  const existing = await db
    .select({ kind: priceAlert.kind })
    .from(priceAlert)
    .where(
      and(
        eq(priceAlert.userId, userId),
        eq(priceAlert.tradeId, tradeId),
        eq(priceAlert.active, true),
      ),
    )
  const already = new Set(existing.map((e) => e.kind))

  const levels: { kind: AlertKind; level: number | null }[] = [
    { kind: 'einstieg', level: t.entryPrice },
    { kind: 'stop', level: t.stopLoss },
    { kind: 'ziel', level: t.takeProfit },
  ]

  const rows: (typeof priceAlert.$inferInsert)[] = []
  for (const { kind, level } of levels) {
    if (level == null || already.has(kind)) continue
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

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

/**
 * Alle sichtbaren Alerts (aktiv & nicht verworfen) — sowohl offene als auch
 * ausgelöste, die noch nicht weggeräumt sind. Ausgelöste zuerst, dann nach
 * Anlage-Zeit. Verworfene (dismissed) tauchen nicht auf.
 */
export async function listAlerts(): Promise<AlertView[]> {
  const userId = await getUserId()
  const rows = await db
    .select()
    .from(priceAlert)
    .where(and(eq(priceAlert.userId, userId), eq(priceAlert.active, true)))
    .orderBy(desc(priceAlert.triggeredAt), desc(priceAlert.createdAt))
  return rows.map(toView)
}

// ---------------------------------------------------------------------------
// Abgleich (der Kern)
// ---------------------------------------------------------------------------

/**
 * Prüft alle offenen Alerts gegen den aktuellen Kurs und markiert die
 * erreichten als ausgelöst. Gibt die NEU ausgelösten zurück, damit der Client
 * eine Benachrichtigung zeigen kann.
 *
 * Kurse werden je Symbol nur EINMAL geholt (gruppiert) und sind 15 Min gecacht —
 * das schont das Twelve-Data-Gratislimit auch bei mehreren offenen Positionen.
 * Symbole, deren Kurs gerade nicht abrufbar ist, bleiben unangetastet und werden
 * beim nächsten Lauf erneut geprüft.
 */
export async function checkAlerts(): Promise<AlertView[]> {
  const userId = await getUserId()
  const open = await db
    .select()
    .from(priceAlert)
    .where(
      and(
        eq(priceAlert.userId, userId),
        eq(priceAlert.active, true),
        isNull(priceAlert.triggeredAt),
      ),
    )
  if (open.length === 0) return []

  // Nach Symbol gruppieren — ein Kursabruf je (ticker, market).
  const groups = new Map<string, AlertRow[]>()
  for (const a of open) {
    const key = `${a.ticker}|${a.market}`
    const list = groups.get(key)
    if (list) list.push(a)
    else groups.set(key, [a])
  }

  const triggeredIds: number[] = []
  for (const [key, list] of groups) {
    const [ticker, market] = key.split('|')
    const quote = await tryQuote(ticker, market as Market)
    if (!quote) continue // Kurs nicht abrufbar → beim nächsten Lauf erneut
    for (const a of list) {
      if (!isAlertDirection(a.direction)) continue
      // High/Low der letzten Kerze erfasst auch eine kurze Berührung innerhalb der Kerze.
      if (candleReachesLevel(a.direction, a.price, quote)) triggeredIds.push(a.id)
    }
  }

  if (triggeredIds.length === 0) return []

  const now = new Date()
  const updated = await db
    .update(priceAlert)
    .set({ triggeredAt: now })
    .where(
      and(
        eq(priceAlert.userId, userId),
        inArray(priceAlert.id, triggeredIds),
        isNull(priceAlert.triggeredAt), // Wettlauf-sicher: nur, was noch offen war
      ),
    )
    .returning()

  if (updated.length) revalidatePath('/')
  return updated.map(toView)
}

// ---------------------------------------------------------------------------
// Verwalten
// ---------------------------------------------------------------------------

/** Alert wegräumen (aus der Übersicht entfernen) — Historie bleibt als Zeile erhalten. */
export async function dismissAlert(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .update(priceAlert)
    .set({ active: false })
    .where(and(eq(priceAlert.id, id), eq(priceAlert.userId, userId)))
  revalidatePath('/')
}

/** Alert endgültig löschen. */
export async function deleteAlert(id: number): Promise<void> {
  const userId = await getUserId()
  await db
    .delete(priceAlert)
    .where(and(eq(priceAlert.id, id), eq(priceAlert.userId, userId)))
  revalidatePath('/')
}
